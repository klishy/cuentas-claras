from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from collections import defaultdict

from .. import models, schemas, auth
from ..database import get_db
from .groups_router import _get_group_or_404

router = APIRouter(prefix="/groups/{group_id}/expenses", tags=["Gastos"])


@router.post("/", response_model=schemas.ExpenseOut)
def create_expense(
    group_id: int,
    expense: schemas.ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)

    payer = db.query(models.User).filter(models.User.id == expense.paid_by_id).first()
    if not payer or payer not in group.members:
        raise HTTPException(status_code=400, detail="Quien pagó debe ser miembro del grupo")

    # Determinar entre quiénes se divide
    if expense.split_between_ids:
        participants = [m for m in group.members if m.id in expense.split_between_ids]
        if not participants:
            raise HTTPException(status_code=400, detail="Participantes inválidos")
    else:
        participants = group.members  # división pareja entre todos

    share = round(expense.amount / len(participants), 2)

    new_expense = models.Expense(
        group_id=group.id,
        description=expense.description,
        amount=expense.amount,
        paid_by_id=payer.id,
    )
    db.add(new_expense)
    db.flush()  # para obtener new_expense.id antes de commit

    # Ajuste de centavos: el último participante absorbe la diferencia de redondeo
    total_assigned = 0.0
    for i, member in enumerate(participants):
        amount = share
        if i == len(participants) - 1:
            amount = round(expense.amount - total_assigned, 2)
        total_assigned = round(total_assigned + amount, 2)

        split = models.ExpenseSplit(
            expense_id=new_expense.id,
            user_id=member.id,
            amount_owed=amount,
            settled=(member.id == payer.id),  # el que paga no se debe a sí mismo
        )
        db.add(split)

    db.commit()
    db.refresh(new_expense)
    return _serialize_expense(new_expense)


@router.get("/", response_model=List[schemas.ExpenseOut])
def list_expenses(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)
    return [_serialize_expense(e) for e in group.expenses]


@router.delete("/{expense_id}")
def delete_expense(
    group_id: int,
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)
    expense = db.query(models.Expense).filter(
        models.Expense.id == expense_id, models.Expense.group_id == group.id
    ).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    db.delete(expense)
    db.commit()
    return {"ok": True}


@router.post("/{expense_id}/settle/{split_id}")
def settle_split(
    group_id: int,
    expense_id: int,
    split_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    _get_group_or_404(db, group_id, current_user)
    split = db.query(models.ExpenseSplit).filter(
        models.ExpenseSplit.id == split_id, models.ExpenseSplit.expense_id == expense_id
    ).first()
    if not split:
        raise HTTPException(status_code=404, detail="División no encontrada")
    split.settled = True
    db.commit()
    return {"ok": True}


# ---------- Balances y simplificación de deudas ----------

balance_router = APIRouter(prefix="/groups/{group_id}/balances", tags=["Balances"])


@balance_router.get("/", response_model=List[schemas.BalanceEntry])
def get_balances(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)
    net = defaultdict(float)  # user_id -> balance neto

    for expense in group.expenses:
        for split in expense.splits:
            if split.settled:
                continue
            net[split.user_id] -= split.amount_owed
            net[expense.paid_by_id] += split.amount_owed

    result = []
    for member in group.members:
        result.append(
            schemas.BalanceEntry(
                user_id=member.id,
                user_name=member.name,
                balance=round(net.get(member.id, 0.0), 2),
            )
        )
    return result


@balance_router.get("/simplified", response_model=List[schemas.SimplifiedDebt])
def get_simplified_debts(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Algoritmo greedy de simplificación de deudas:
    minimiza el número de transacciones necesarias para saldar todas las cuentas del grupo.
    """
    balances = get_balances(group_id, db, current_user)

    debtors = sorted([b for b in balances if b.balance < -0.01], key=lambda b: b.balance)
    creditors = sorted([b for b in balances if b.balance > 0.01], key=lambda b: -b.balance)

    debtors = [{"user_name": d.user_name, "amount": -d.balance} for d in debtors]
    creditors = [{"user_name": c.user_name, "amount": c.balance} for c in creditors]

    transactions = []
    i, j = 0, 0
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i]["amount"], creditors[j]["amount"])
        transactions.append(
            schemas.SimplifiedDebt(
                from_user=debtors[i]["user_name"],
                to_user=creditors[j]["user_name"],
                amount=round(pay, 2),
            )
        )
        debtors[i]["amount"] -= pay
        creditors[j]["amount"] -= pay
        if debtors[i]["amount"] < 0.01:
            i += 1
        if creditors[j]["amount"] < 0.01:
            j += 1

    return transactions


def _serialize_expense(expense: models.Expense) -> dict:
    return {
        "id": expense.id,
        "description": expense.description,
        "amount": expense.amount,
        "paid_by_id": expense.paid_by_id,
        "paid_by_name": expense.paid_by.name,
        "created_at": expense.created_at,
        "splits": [
            {
                "user_id": s.user_id,
                "user_name": s.user.name,
                "amount_owed": s.amount_owed,
                "settled": s.settled,
            }
            for s in expense.splits
        ],
    }

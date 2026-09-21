from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from collections import defaultdict
from datetime import datetime

from .. import models, schemas, auth
from ..database import get_db
from ..categories import VALID_CATEGORIES
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

    if expense.split_method not in ("equal", "income", "manual"):
        raise HTTPException(status_code=400, detail="Método de división inválido")

    category = expense.category if expense.category in VALID_CATEGORIES else "otros"

    # Determinar entre quiénes se divide
    if expense.split_between_ids:
        participants = [m for m in group.members if m.id in expense.split_between_ids]
        if not participants:
            raise HTTPException(status_code=400, detail="Participantes inválidos")
    else:
        participants = group.members  # división pareja entre todos

    shares = {}  # user_id -> monto que le corresponde pagar

    if expense.split_method == "income":
        memberships = {m.user_id: m for m in group.memberships if m.user_id in [p.id for p in participants]}

        missing = [p.name for p in participants if memberships.get(p.id) is None or memberships[p.id].income is None]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Faltan por declarar su sueldo: {', '.join(missing)}. Todos deben declararlo antes de dividir por sueldo.",
            )

        incomes = {uid: m.income for uid, m in memberships.items()}
        total_income = sum(incomes.values())

        if total_income <= 0:
            raise HTTPException(
                status_code=400,
                detail="La suma de los sueldos declarados debe ser mayor a cero",
            )

        for p in participants:
            shares[p.id] = round(expense.amount * (incomes[p.id] / total_income), 2)

    elif expense.split_method == "manual":
        if not expense.manual_shares:
            raise HTTPException(
                status_code=400,
                detail="Debes indicar el monto exacto para cada participante",
            )

        manual_map = {s.user_id: s.amount for s in expense.manual_shares}
        participant_ids = {p.id for p in participants}

        if set(manual_map.keys()) != participant_ids:
            raise HTTPException(
                status_code=400,
                detail="Debes indicar un monto para cada participante seleccionado, ni más ni menos",
            )

        total_manual = round(sum(manual_map.values()), 2)
        if abs(total_manual - round(expense.amount, 2)) > 0.5:
            raise HTTPException(
                status_code=400,
                detail=f"Los montos deben sumar el total del gasto (${expense.amount:,.0f}), pero suman ${total_manual:,.0f}",
            )

        for p in participants:
            shares[p.id] = round(manual_map[p.id], 2)

    else:  # equal
        share = round(expense.amount / len(participants), 2)
        for p in participants:
            shares[p.id] = share

    new_expense = models.Expense(
        group_id=group.id,
        description=expense.description,
        amount=expense.amount,
        paid_by_id=payer.id,
        split_method=expense.split_method,
        category=category,
    )
    db.add(new_expense)
    db.flush()  # para obtener new_expense.id antes de commit

    # Ajuste de centavos: el último participante absorbe la diferencia de redondeo
    # (no se aplica en modo manual, ahí los montos ya son exactos y elegidos a mano)
    total_assigned = 0.0
    for i, member in enumerate(participants):
        amount = shares[member.id]
        if expense.split_method != "manual" and i == len(participants) - 1:
            amount = round(expense.amount - total_assigned, 2)
        total_assigned = round(total_assigned + amount, 2)

        split = models.ExpenseSplit(
            expense_id=new_expense.id,
            user_id=member.id,
            amount_owed=amount,
            settled=(member.id == payer.id),  # el que paga no se debe a sí mismo
            settled_at=datetime.utcnow() if member.id == payer.id else None,
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
    split.settled_at = datetime.utcnow()
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
        "split_method": expense.split_method,
        "category": expense.category,
        "created_at": expense.created_at,
        "splits": [
            {
                "id": s.id,
                "user_id": s.user_id,
                "user_name": s.user.name,
                "amount_owed": s.amount_owed,
                "settled": s.settled,
                "settled_at": s.settled_at,
            }
            for s in expense.splits
        ],
    }

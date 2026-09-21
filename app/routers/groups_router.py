from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/groups", tags=["Grupos"])

# --- Límites del plan gratuito (freemium) ---
FREE_MAX_GROUPS = 2
FREE_MAX_MEMBERS_PER_GROUP = 4


@router.post("/", response_model=schemas.GroupOut)
def create_group(
    group: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not current_user.is_premium:
        owned_groups = (
            db.query(models.Group)
            .filter(models.Group.created_by_id == current_user.id)
            .count()
        )
        if owned_groups >= FREE_MAX_GROUPS:
            raise HTTPException(
                status_code=402,
                detail=f"Plan gratuito limitado a {FREE_MAX_GROUPS} grupos creados. Actualiza a Premium para crear más.",
            )

    new_group = models.Group(name=group.name, created_by_id=current_user.id)
    new_group.members.append(current_user)
    db.add(new_group)
    db.commit()
    db.refresh(new_group)
    return new_group


@router.get("/", response_model=List[schemas.GroupOut])
def list_my_groups(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return current_user.groups


@router.get("/{group_id}", response_model=schemas.GroupOut)
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)
    return group


@router.post("/{group_id}/members", response_model=schemas.GroupOut)
def add_member(
    group_id: int,
    payload: schemas.AddMember,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)
    owner = db.query(models.User).filter(models.User.id == group.created_by_id).first()

    if not (owner and owner.is_premium) and len(group.members) >= FREE_MAX_MEMBERS_PER_GROUP:
        raise HTTPException(
            status_code=402,
            detail=f"Plan gratuito limitado a {FREE_MAX_MEMBERS_PER_GROUP} integrantes por grupo. Actualiza a Premium.",
        )

    user_to_add = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user_to_add:
        raise HTTPException(status_code=404, detail="No existe un usuario con ese correo")

    if user_to_add in group.members:
        raise HTTPException(status_code=400, detail="Ese usuario ya es miembro del grupo")

    group.members.append(user_to_add)
    db.commit()
    db.refresh(group)
    return group


def _get_group_or_404(db: Session, group_id: int, current_user: models.User) -> models.Group:
    group = db.query(models.Group).filter(models.Group.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo no encontrado")
    if current_user not in group.members:
        raise HTTPException(status_code=403, detail="No perteneces a este grupo")
    return group


# ---------- Sueldos (para división proporcional al ingreso) ----------

@router.get("/{group_id}/incomes", response_model=List[schemas.MemberIncomeOut])
def get_incomes(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)
    result = []
    for m in group.memberships:
        result.append(
            schemas.MemberIncomeOut(user_id=m.user_id, user_name=m.user.name, income=m.income)
        )
    return result


@router.put("/{group_id}/my-income", response_model=schemas.MemberIncomeOut)
def set_my_income(
    group_id: int,
    payload: schemas.SetIncomeIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    group = _get_group_or_404(db, group_id, current_user)

    if payload.income < 0:
        raise HTTPException(status_code=400, detail="El sueldo no puede ser negativo")

    membership = next((m for m in group.memberships if m.user_id == current_user.id), None)
    if not membership:
        raise HTTPException(status_code=404, detail="Membresía no encontrada")

    membership.income = payload.income
    db.commit()
    return schemas.MemberIncomeOut(
        user_id=current_user.id, user_name=current_user.name, income=membership.income
    )

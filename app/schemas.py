from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime


# ---------- Usuario ----------
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    is_premium: bool = False

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Grupo ----------
class GroupCreate(BaseModel):
    name: str


class GroupOut(BaseModel):
    id: int
    name: str
    members: List[UserOut] = []

    class Config:
        from_attributes = True


class AddMember(BaseModel):
    email: EmailStr


class MemberIncomeOut(BaseModel):
    user_id: int
    user_name: str
    income: Optional[float] = None


class SetIncomeIn(BaseModel):
    income: float


# ---------- Gasto ----------
class ManualShare(BaseModel):
    user_id: int
    amount: float


class ExpenseCreate(BaseModel):
    description: str
    amount: float
    paid_by_id: int
    category: str = "otros"
    # "equal" (partes iguales), "income" (proporcional al sueldo) o "manual" (montos elegidos a mano)
    split_method: str = "equal"
    # Si no se especifica, se divide entre todos los miembros del grupo
    split_between_ids: Optional[List[int]] = None
    # Solo si split_method == "manual": monto exacto que le corresponde a cada participante
    manual_shares: Optional[List[ManualShare]] = None


class SplitOut(BaseModel):
    id: int
    user_id: int
    user_name: str
    amount_owed: float
    settled: bool
    settled_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ExpenseOut(BaseModel):
    id: int
    description: str
    amount: float
    paid_by_id: int
    paid_by_name: str
    split_method: str
    category: str
    created_at: datetime
    splits: List[SplitOut] = []

    class Config:
        from_attributes = True


class SettleSplit(BaseModel):
    split_id: int


# ---------- Balance ----------
class BalanceEntry(BaseModel):
    user_id: int
    user_name: str
    balance: float  # positivo = le deben, negativo = debe


class SimplifiedDebt(BaseModel):
    from_user: str
    to_user: str
    amount: float


# ---------- Resumen general (para aviso de deudas pendientes) ----------
class ResumenGrupoEntry(BaseModel):
    group_id: int
    group_name: str
    balance: float  # positivo = le deben en ese grupo, negativo = debe


class ResumenPendientes(BaseModel):
    total_le_deben: float
    total_debe: float
    detalle: List[ResumenGrupoEntry]

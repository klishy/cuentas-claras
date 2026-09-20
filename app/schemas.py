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


# ---------- Gasto ----------
class ExpenseCreate(BaseModel):
    description: str
    amount: float
    paid_by_id: int
    # Si no se especifica, se divide en partes iguales entre todos los miembros del grupo
    split_between_ids: Optional[List[int]] = None


class SplitOut(BaseModel):
    user_id: int
    user_name: str
    amount_owed: float
    settled: bool

    class Config:
        from_attributes = True


class ExpenseOut(BaseModel):
    id: int
    description: str
    amount: float
    paid_by_id: int
    paid_by_name: str
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

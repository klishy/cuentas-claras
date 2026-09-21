from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey, DateTime, Boolean
)
from sqlalchemy.orm import relationship
from sqlalchemy.ext.associationproxy import association_proxy
from datetime import datetime

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_premium = Column(Boolean, default=False)  # true si pagó la suscripción
    created_at = Column(DateTime, default=datetime.utcnow)

    memberships = relationship(
        "GroupMembership", back_populates="user", cascade="all, delete-orphan"
    )
    groups = association_proxy(
        "memberships", "group", creator=lambda group: GroupMembership(group=group)
    )
    expenses_paid = relationship("Expense", back_populates="paid_by")


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    created_by_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    # "equal" = partes iguales | "income" = proporcional al sueldo de cada uno
    default_split_method = Column(String, default="equal")

    memberships = relationship(
        "GroupMembership", back_populates="group", cascade="all, delete-orphan"
    )
    members = association_proxy(
        "memberships", "user", creator=lambda user: GroupMembership(user=user)
    )
    expenses = relationship("Expense", back_populates="group", cascade="all, delete")


class GroupMembership(Base):
    """Relación usuario-grupo, guarda datos propios de esa membresía (ej: sueldo)."""
    __tablename__ = "group_memberships"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    income = Column(Float, nullable=True)  # sueldo declarado para este grupo

    group = relationship("Group", back_populates="memberships")
    user = relationship("User", back_populates="memberships")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"))
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    paid_by_id = Column(Integer, ForeignKey("users.id"))
    split_method = Column(String, default="equal")  # "equal" | "income" | "manual"
    category = Column(String, default="otros")
    created_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("Group", back_populates="expenses")
    paid_by = relationship("User", back_populates="expenses_paid")
    splits = relationship("ExpenseSplit", back_populates="expense", cascade="all, delete")


class ExpenseSplit(Base):
    """Cuánto le corresponde pagar a cada usuario de un gasto específico."""
    __tablename__ = "expense_splits"

    id = Column(Integer, primary_key=True, index=True)
    expense_id = Column(Integer, ForeignKey("expenses.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    amount_owed = Column(Float, nullable=False)
    settled = Column(Boolean, default=False)
    settled_at = Column(DateTime, nullable=True)

    expense = relationship("Expense", back_populates="splits")
    user = relationship("User")

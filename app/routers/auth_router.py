from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/register", response_model=schemas.Token)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ese correo ya está registrado")

    if user.avatar and (len(user.avatar) > 400_000 or not user.avatar.startswith("data:image/")):
        raise HTTPException(status_code=400, detail="Foto de perfil no válida")
    if user.birth_date > date.today():
        raise HTTPException(status_code=400, detail="La fecha de nacimiento no es válida")

    new_user = models.User(
        name=user.name,
        birth_date=user.birth_date.isoformat(),
        avatar=user.avatar,
        email=user.email,
        hashed_password=auth.hash_password(user.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = auth.create_access_token({"sub": str(new_user.id)})
    return {"access_token": token, "user": new_user}


@router.post("/login", response_model=schemas.Token)
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == credentials.email).first()
    if not user or not auth.verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Correo o contraseña incorrectos",
        )

    token = auth.create_access_token({"sub": str(user.id)})
    return {"access_token": token, "user": user}


@router.get("/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@router.get("/me/layout")
def get_layout(current_user: models.User = Depends(auth.get_current_user)):
    return {"layout": current_user.layout}


@router.put("/me/layout")
def save_layout(
    body: schemas.LayoutIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if len(body.layout) > 20_000:
        raise HTTPException(status_code=400, detail="Distribución demasiado grande")
    current_user.layout = body.layout
    db.commit()
    return {"ok": True}

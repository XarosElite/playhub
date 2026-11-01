from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.database import get_db
from app.internal.auth import CurrentUser
from app.models.users import User, user_to_dict

router = APIRouter(
    prefix="/users",
    tags=["users"],
)


@router.get('/')
def list_users(user: CurrentUser, db = Depends(get_db)):
    """
    Lists everyone who has signed in to PlayHub, except the caller.
    Used to pick who to share a server with.
    """
    stmt = select(User).where(User.uid != user.uid).order_by(User.name, User.email)
    return {"msg": [user_to_dict(u) for u in db.scalars(stmt)]}

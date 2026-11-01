from fastapi import APIRouter

from app.internal.auth import CurrentUser

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
)


@router.get('/me')
def get_me(user: CurrentUser):
    """
    Returns the signed-in user. The frontend calls this after signing in to
    confirm the backend accepts the account (e.g. it is on the allowlist).
    """
    return {"msg": {"uid": user.uid, "email": user.email, "name": user.name, "picture": user.picture}}

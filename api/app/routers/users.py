from fastapi import APIRouter

router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)

@router.get("/{username}", tags=["examples"])
async def read_user(username: str):
    return {"username": username}

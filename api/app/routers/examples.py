from fastapi import APIRouter

router = APIRouter(
    prefix="/examples",
    tags=["examples"],
    dependencies=[],
    responses={404: {"description": "Not found"}},
)

@router.get("/examples/{username}", tags=["examples"])
async def read_user(username: str):
    return {"username": username}

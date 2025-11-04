from sqlalchemy import Column, Integer, String
from app.database import Base

class Server(Base):
    __tablename__ = "servers"

    id = Column(Integer, primary_key=True, index=True)
    created = Column(String, index=True)
    game_type = Column(String, index=True)
    container_id = Column(String, index=True)
    name = Column(String, index=True)
    state = Column(String, index=True)
    port = Column(Integer, index=True)

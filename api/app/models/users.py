from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime
from app.database import Base


class User(Base):
    """
    Directory of people who have signed in. Accounts live in Firebase; this is
    a profile cache (refreshed on sign-in) so users can find each other, e.g.
    when sharing a server.
    """
    __tablename__ = "users"

    uid = Column(String, primary_key=True)  # Firebase user ID
    email = Column(String, nullable=True, index=True)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    created = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_seen = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def user_to_dict(user):
    return {"uid": user.uid, "name": user.name, "email": user.email, "picture": user.picture}

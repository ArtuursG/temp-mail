from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class MessageSummary(BaseModel):
    id: str
    from_addr: str
    from_name: str = ""
    to_addr: str = ""
    subject: str = ""
    intro: str = ""
    received_at: Optional[datetime] = None
    has_attachments: bool = False


class MessageFull(MessageSummary):
    text: str = ""
    html: str = ""


class InboxPublic(BaseModel):
    id: str
    address: str
    provider: str
    created_at: datetime
    expires_at: datetime


class CreateInboxRequest(BaseModel):
    provider: Optional[str] = None

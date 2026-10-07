from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Attachment(BaseModel):
    id: str
    filename: str = "attachment"
    size: int = 0
    content_type: str = ""


class MessageSummary(BaseModel):
    id: str
    from_addr: str
    from_name: str = ""
    to_addr: str = ""
    subject: str = ""
    intro: str = ""
    received_at: datetime | None = None
    has_attachments: bool = False


class MessageFull(MessageSummary):
    text: str = ""
    html: str = ""
    attachments: list[Attachment] = Field(default_factory=list)


class InboxPublic(BaseModel):
    id: str
    address: str
    provider: str
    created_at: datetime
    expires_at: datetime


class ProviderInfo(BaseModel):
    name: str
    label: str
    retention_seconds: int
    #: anyone who knows the address can read the inbox (no password)
    public_inboxes: bool = False


class CreateInboxRequest(BaseModel):
    provider: str | None = None
    #: wanted name before the @; random when empty
    local_part: str | None = Field(default=None, max_length=64)
    #: wanted domain; random active one when empty or unknown
    domain: str | None = Field(default=None, max_length=253)

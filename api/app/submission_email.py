"""Send the Organiser a plain-text receipt after a successful submission."""

import smtplib
import ssl
from email.message import EmailMessage

from flask import current_app

from .supabase_client import get_supabase_client


def send_submission_confirmation(event: dict) -> bool:
    """Email failure must not undo a saved request or encourage duplicate submission."""
    config = current_app.config
    if not config.get("SMTP_HOST"):
        return False

    try:
        client = get_supabase_client()
        users = client.table("app_users").select("email").eq(
            "id", event["organiser_id"]
        ).execute().data
        recipient = users[0].get("email") if users else None
        if not recipient:
            current_app.logger.warning("Submission email has no recipient: event=%s", event["id"])
            return False

        message = EmailMessage()
        message["From"] = config["SMTP_FROM"]
        message["To"] = recipient
        message["Subject"] = f"ConnectSphere request received — {event['id']}"
        message.set_content(
            "We have received your event request.\n\n"
            f"Event: {event['title']}\n"
            f"Reference: {event['id']}\n"
            f"Submitted at: {event['submitted_at']}\n"
            "Status: Planning\n\n"
            "Your coordinator will review it. Direct editing is now locked; "
            "you can make amendments when your coordinator requests clarification.\n"
        )
        with smtplib.SMTP(config["SMTP_HOST"], config["SMTP_PORT"], timeout=5) as smtp:
            if config["SMTP_STARTTLS"]:
                smtp.starttls(context=ssl.create_default_context())
            if config.get("SMTP_USERNAME"):
                smtp.login(config["SMTP_USERNAME"], config["SMTP_PASSWORD"])
            smtp.send_message(message)
        return True
    except Exception:
        # Do not log SMTP credentials, message bodies, or provider error responses.
        current_app.logger.warning("Submission email failed: event=%s", event["id"])
        return False

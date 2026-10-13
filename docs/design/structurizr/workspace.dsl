workspace "ConnectSphere" "Event lifecycle management web app. C4 model per IS212 Week 4 lecture: C1 System Context + C2 Container only." {

    model {
        # --- People (roles) ---
        organiser  = person "Event Organiser"  "Raises an event request and tracks it through to confirmation."
        coordinator = person "Coordinator"     "Reviews, approves, and assigns event requests."
        venueStaff = person "Venue Staff"       "Handles venue booking for approved events."
        techSupport = person "Technical Support" "Handles equipment booking and technical setup."
        attendee   = person "Attendee"          "Registers for events and receives confirmations."

        # --- The system in focus ---
        connectSphere = softwareSystem "ConnectSphere" "Manages the event lifecycle: request, review/approve/assign, venue and equipment booking, attendee registration, and confirmation." {

            webapp = container "Web Application" "Serves the ConnectSphere UI and handles client-side interaction for all roles." "Next.js (React) + Tailwind CSS"

            api = container "Backend API" "Implements event lifecycle logic: requests, approvals, assignments, bookings, registrations, and confirmations. Exposes a REST API." "Python Flask REST API"
        }

        # --- External systems (team does not run these) ---
        supabase = softwareSystem "Supabase" "Managed SaaS providing the Postgres database and authentication." "External SaaS" {
            tags "External"
        }

        emailService = softwareSystem "Email / Notification Service" "Sends confirmation emails and event notifications." "External" {
            tags "External"
        }

        # --- C1 relationships: people -> system, system -> external systems ---
        organiser   -> connectSphere "Raises event requests and tracks status using" "HTTPS"
        coordinator -> connectSphere "Reviews, approves, and assigns events using" "HTTPS"
        venueStaff  -> connectSphere "Books venues for approved events using" "HTTPS"
        techSupport -> connectSphere "Books equipment and sets up technical support using" "HTTPS"
        attendee    -> connectSphere "Registers for events and receives confirmations using" "HTTPS"

        connectSphere -> supabase "Reads from and writes to; authenticates users against" "HTTPS/JSON (Postgres + Auth)"
        connectSphere -> emailService "Sends confirmations and notifications via" "HTTPS/SMTP"

        # --- C2 relationships: inside the ConnectSphere boundary ---
        # People interact with the Web Application (the only entry point).
        organiser   -> webapp "Uses" "HTTPS"
        coordinator -> webapp "Uses" "HTTPS"
        venueStaff  -> webapp "Uses" "HTTPS"
        techSupport -> webapp "Uses" "HTTPS"
        attendee    -> webapp "Uses" "HTTPS"

        webapp -> api "Makes API calls to" "HTTPS/JSON (REST)"

        # Backend depends on Supabase for data + auth.
        # Sprint 1 note: auth is currently a stub / seeded-users role-switcher in the
        # Backend API; Supabase Auth will later replace it. Kept as one dependency (no extra box).
        api -> supabase "Reads/writes event data and verifies auth via" "HTTPS/JSON (Postgres + Auth)"
        api -> emailService "Sends confirmation and notification emails via" "HTTPS/SMTP"
    }

    views {
        systemContext connectSphere "C1_SystemContext" {
            include *
            autolayout lr
            description "C1: ConnectSphere as a single system, its five user roles, and the external SaaS it depends on."
        }

        container connectSphere "C2_Container" {
            include *
            autolayout lr
            description "C2: The applications and dependencies inside the ConnectSphere boundary. A container = a separately running app or data store, not a Docker container."
        }

        styles {
            element "Person" {
                shape person
                background #08427b
                color #ffffff
            }
            element "Software System" {
                background #1168bd
                color #ffffff
            }
            element "External" {
                background #999999
                color #ffffff
            }
            element "Container" {
                background #438dd5
                color #ffffff
            }
        }
    }
}

workspace "ConnectSphere" "Event lifecycle management web app. C4 model per IS212 Week 4 lecture: C1 System Context + C2 Container only." {

    model {
        # --- People (roles) ---
        organiser  = person "Event Organiser"  "Raises an event request and tracks it through to confirmation."
        coordinator = person "Event Coordinator" "Reviews, approves, and manages assigned event requests."
        lead       = person "Event Coordinator Lead" "Oversees intake, assigns and reassigns Coordinators (SCRUM-131)."
        venueStaff = person "Venue Staff"       "Handles venue booking for approved events."
        techSupport = person "Technical Support" "Handles equipment booking and technical setup."
        attendee   = person "Attendee"          "Registers for events and receives confirmations."
        safetyOfficer = person "Safety Officer" "Reviews the operational safety of confirmed events before preparation (SCRUM-127/128)."

        # --- The system in focus ---
        connectSphere = softwareSystem "ConnectSphere" "Manages the event lifecycle: request, review/approve/assign, venue and equipment booking, attendee registration, and confirmation." {

            webapp = container "Web Application" "Serves the ConnectSphere UI and handles client-side interaction for all roles." "Next.js (React) + Tailwind CSS"

            api = container "Backend API" "Implements event lifecycle logic: requests, approvals, assignments, bookings, registrations, confirmations. Owns Flask session login and writes in-app notifications. Exposes a REST API." "Python Flask REST API"
        }

        # --- External systems (team does not run these) ---
        supabase = softwareSystem "Supabase" "Managed SaaS providing the Postgres database. Not run locally." "External SaaS" {
            tags "External"
        }

        # --- C1 relationships: people -> system, system -> external systems ---
        organiser   -> connectSphere "Raises event requests and tracks status using" "HTTPS"
        coordinator -> connectSphere "Reviews, approves, and manages assigned events using" "HTTPS"
        lead        -> connectSphere "Assigns and reassigns Coordinators using" "HTTPS"
        venueStaff  -> connectSphere "Books venues for approved events using" "HTTPS"
        techSupport -> connectSphere "Books equipment and sets up technical support using" "HTTPS"
        attendee    -> connectSphere "Registers for events and receives confirmations using" "HTTPS"
        safetyOfficer -> connectSphere "Reviews operational safety of confirmed events using" "HTTPS"

        connectSphere -> supabase "Reads from and writes to" "HTTPS/JSON (Postgres)"

        # --- C2 relationships: inside the ConnectSphere boundary ---
        # People interact with the Web Application (the only entry point).
        organiser   -> webapp "Uses" "HTTPS"
        coordinator -> webapp "Uses" "HTTPS"
        lead        -> webapp "Uses" "HTTPS"
        venueStaff  -> webapp "Uses" "HTTPS"
        techSupport -> webapp "Uses" "HTTPS"
        attendee    -> webapp "Uses" "HTTPS"
        safetyOfficer -> webapp "Uses" "HTTPS"

        webapp -> api "Makes API calls to" "HTTPS/JSON (REST)"

        # The Backend API authenticates users itself (Flask session login) and stores
        # all event data plus in-app notifications in the Supabase Postgres database.
        # There is no external auth or email provider; notifications are in-app.
        api -> supabase "Reads/writes event data and in-app notifications in" "HTTPS/JSON (Postgres)"
    }

    views {
        systemContext connectSphere "C1_SystemContext" {
            include *
            autolayout lr
            description "C1: ConnectSphere as a single system, its seven user roles, and the external Postgres database it depends on."
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

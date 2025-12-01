**DB Revamp Proposal (Locations, Dates, Labs, Costs)**
- **Goal:** Add structured shooting date/location to Photo; city-level locations to Roll; lab/process/cost fields; keep data normalized and maintainable.

**Schema Changes**
- `locations` table: `id`, `country_code`, `country_name`, `city_name`, `city_lat`, `city_lng`.
- `roll_locations` table: `roll_id`, `location_id` (many-to-many for rolls).
- `rolls` add: `develop_lab`, `develop_process`, `develop_date`, `purchase_cost`, `develop_cost`, `purchase_channel`, `batch_number`, `develop_note`.
- `photos` add: `date_taken`, `time_taken`, `location_id` (nullable), `detail_location`, `latitude`, `longitude`.

**Business Rules**
- Photo `date_taken` must be within Roll start/end dates.
- Photo location selection: choose country/city from `locations`; `latitude/longitude` init from city and editable.
- When Photo selects a `location_id` not linked to its Roll, auto-insert into `roll_locations`.
- Roll edit/create: allow multiple city selections via `+`.
- Process preset values: `C-41`, `E-6`, `BW`, `ECN-2`, `RA-4(print)`; free text allowed.

**API Updates**
- `GET /locations?country=XX&query=...` search cities.
- `POST /locations` to add missing city (admin-guarded if needed).
- `PUT /rolls/:id` accepts `locations: number[]` and develop fields.
- `PUT /photos/:id` accepts `date_taken`, `location_id`, `detail_location`, `latitude`, `longitude` and applies validations.

**Frontend**
- Roll form: multi-select cities; lab/process (with presets); costs; date.
- Photo form: date picker (bounded by roll dates); country/city choose; detail text; map or lat/lng manual.

**Migration Plan**
- Create tables and columns; backfill `roll_locations` using existing tags/metadata when possible.
- For Photos without `date_taken`, optionally infer from file EXIF (future step).

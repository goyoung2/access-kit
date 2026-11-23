-- Additive indexes only: no member, role, invitation or roster rows are changed.
CREATE INDEX permission_reservation_global_page ON permission_reservations(created_at DESC,id DESC);
CREATE INDEX permission_reservation_service_page ON permission_reservations(client_id,created_at DESC,id DESC);

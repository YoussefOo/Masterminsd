Docker Compose isolation change

Only docker-compose.yml was changed for this fix:
- Removed fixed container_name values for mariadb, app, and phpmyadmin.
- Removed the fixed default network name.

The service names remain `mariadb`, `app`, and `phpmyadmin`, so internal DNS
and DB_HOST/PMA_HOST continue to work unchanged.
The named database volume `mariadb_data` is intentionally preserved; do not
use `docker compose down -v` if existing database data must be retained.

No frontend, TypeScript, Game logic, backend Java, API, or SCSS was changed.

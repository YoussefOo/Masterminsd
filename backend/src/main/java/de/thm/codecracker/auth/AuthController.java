package de.thm.codecracker.auth;

import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Tuple;
import org.mindrot.jbcrypt.BCrypt;
import java.util.Base64;

public class AuthController {

    private final Pool dbClient;

    public AuthController(Pool dbClient) {
        this.dbClient = dbClient;
    }

    public void handleLogin(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        if (body == null) {
            sendResponse(ctx, 400, "Ungültiger Request Body");
            return;
        }

        String username = body.getString("username");
        String password = body.getString("password");

        if (username == null || password == null || username.isBlank() || password.isBlank()) {
            sendResponse(ctx, 400, "Benutzername und Passwort sind erforderlich");
            return;
        }

        String selectSql = "SELECT id, username, password_hash, role FROM users WHERE username = ?";

        dbClient.preparedQuery(selectSql)
            .execute(Tuple.of(username))
            .onSuccess(rows -> {
                if (rows.size() > 0) {
                    var row = rows.iterator().next();
                    String dbPasswordHash = row.getString("password_hash");
                    String role = row.getString("role");
                    int userId = row.getInteger("id");

                    if (BCrypt.checkpw(password, dbPasswordHash)) {
                        // Spieler sind nach erfolgreichem Login bereit.
                        // Ein Spieler, der bereits in einer laufenden Partie ist,
                        // bleibt dagegen auf "spielend".
                        final String effectiveRole = role != null ? role : "PLAYER";

                        // Der Login setzt einen Spieler auf "bereit".
                        // Falls er gerade spielt, bleibt "spielend" erhalten.
                        io.vertx.core.Future<Void> statusFuture;
                        if ("ADMIN".equalsIgnoreCase(effectiveRole)) {
                            // The administrator is always available/ready after login.
                            statusFuture = dbClient.preparedQuery(
                                    "UPDATE users SET status = 'bereit' WHERE id = ?"
                                )
                                .execute(Tuple.of(userId))
                                .mapEmpty();
                        } else {
                            // A player becomes ready on login unless already in a running game.
                            statusFuture = dbClient.preparedQuery(
                                    "UPDATE users SET status = CASE WHEN status = 'spielend' THEN status ELSE 'bereit' END WHERE id = ?"
                                )
                                .execute(Tuple.of(userId))
                                .mapEmpty();
                        }

                        statusFuture.onSuccess(ignored -> {
                            String rawTokenData = "user:" + username + ":id:" + userId + ":role:" + effectiveRole + ":time:" + System.currentTimeMillis();
                            String uniqueToken = "Bearer-JWT-" + Base64.getEncoder().encodeToString(rawTokenData.getBytes());

                            JsonObject userJson = new JsonObject()
                                .put("status", "ok")
                                .put("userId", userId)
                                .put("username", username)
                                .put("role", effectiveRole)
                                .put("playerStatus", "bereit")
                                .put("token", uniqueToken);

                            sendResponse(ctx, 200, userJson);
                        }).onFailure(err ->
                            sendResponse(ctx, 500, "Status konnte beim Login nicht aktualisiert werden: " + err.getMessage())
                        );
                    } else {
                        sendResponse(ctx, 401, "Ungültiges Passwort!");
                    }
                } else {
                    sendResponse(ctx, 404, "Benutzer nicht gefunden!");
                }
            })
            .onFailure(err -> sendResponse(ctx, 500, "Datenbankfehler: " + err.getMessage()));
    }

    public void handleRegister(RoutingContext ctx) {
        JsonObject body = ctx.body().asJsonObject();
        if (body == null) {
            sendResponse(ctx, 400, "Ungültiger Request Body");
            return;
        }

        final String username = body.getString("username");
        final String password = body.getString("password");
        final String requestedRole = (body.getString("role") == null || body.getString("role").isBlank()) ? "PLAYER" : body.getString("role");

        if (username == null || password == null || username.isBlank() || password.isBlank()) {
            sendResponse(ctx, 400, "Benutzername und Passwort erforderlich");
            return;
        }

        String checkAdminSql = "SELECT COUNT(*) as adminCount FROM users WHERE role = 'ADMIN'";

        dbClient.query(checkAdminSql).execute().onSuccess(adminCheckRes -> {
            int adminCount = adminCheckRes.iterator().next().getInteger("adminCount");

            final String finalRole = (requestedRole.equalsIgnoreCase("ADMIN") && adminCount > 0) ? "DENIED" : 
                                    (adminCount == 0 && requestedRole.equalsIgnoreCase("ADMIN")) ? "ADMIN" : "PLAYER";

            if (finalRole.equals("DENIED")) {
                sendResponse(ctx, 400, "Es gibt bereits einen Administrator! Registrierung als Admin nicht möglich.");
                return;
            }

            final String passwordHash = BCrypt.hashpw(password, BCrypt.gensalt());

            // تعيين الحالة الافتتاحية للمستخدم الجديد لتكون 'ausstehend' وليس 'bereit'
            String insertSql = "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, 'ausstehend')";

            dbClient.preparedQuery(insertSql)
                .execute(Tuple.of(username, passwordHash, finalRole))
                .onSuccess(res -> {
                    JsonObject newUserJson = new JsonObject()
                        .put("status", "created")
                        .put("username", username)
                        .put("role", finalRole);
                    sendResponse(ctx, 201, newUserJson);
                })
                .onFailure(err -> {
                    String msg = err.getMessage().contains("Duplicate") ? "Benutzername existiert bereits!" : "Registrierungsfehler: " + err.getMessage();
                    sendResponse(ctx, 400, msg);
                });

        }).onFailure(err -> {
            sendResponse(ctx, 500, "Datenbankfehler bei Admin-Prüfung: " + err.getMessage());
        });
    }

    private void sendResponse(RoutingContext ctx, int statusCode, Object data) {
        ctx.response()
           .setStatusCode(statusCode)
           .putHeader("Content-Type", "application/json");

        if (data instanceof String msg) {
            ctx.response().end(new JsonObject().put("message", msg).encode());
        } else if (data instanceof JsonObject json) {
            ctx.response().end(json.encode());
        }
    }
}
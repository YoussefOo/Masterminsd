package de.thm.codecracker.auth;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Tuple;

public class AdminController {
    private final Pool dbClient;

    public AdminController(Pool dbClient) {
        this.dbClient = dbClient;
    }

    public void getAllUsers(RoutingContext ctx) {
        dbClient.query("SELECT id, username, role, score, status FROM users")
            .execute()
            .onSuccess(rows -> {
                JsonArray users = new JsonArray();
                for (var row : rows) {
                    JsonObject user = new JsonObject();
                    user.put("id", row.getInteger("id"));
                    user.put("username", row.getString("username"));
                    user.put("role", row.getString("role") != null ? row.getString("role") : "PLAYER");
                    user.put("score", row.getInteger("score") != null ? row.getInteger("score") : 0);
                    user.put("status", row.getString("status") != null ? row.getString("status") : "ausstehend");
                    users.add(user);
                }
                ctx.response().putHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                    .putHeader("Pragma", "no-cache")
                    .putHeader("Content-Type", "application/json").end(users.encode());
            })
            .onFailure(err -> {
                dbClient.query("SELECT id, username, role FROM users")
                    .execute()
                    .onSuccess(fallbackRows -> {
                        JsonArray users = new JsonArray();
                        for (var row : fallbackRows) {
                            users.add(new JsonObject()
                                .put("id", row.getInteger("id"))
                                .put("username", row.getString("username"))
                                .put("role", row.getString("role"))
                                .put("score", 0)
                                .put("status", "ausstehend")
                            );
                        }
                        ctx.response().putHeader("Content-Type", "application/json").end(users.encode());
                    })
                    .onFailure(innerErr -> ctx.response().setStatusCode(500).end(innerErr.getMessage()));
            });
    }

    public void deleteUser(RoutingContext ctx) {
        int userId = Integer.parseInt(ctx.pathParam("id"));
        dbClient.preparedQuery("DELETE FROM users WHERE id = ?").execute(Tuple.of(userId))
            .onSuccess(res -> ctx.response().end("Deleted"))
            .onFailure(err -> ctx.response().setStatusCode(500).end(err.getMessage()));
    }

public void updateUser(RoutingContext ctx) {
        int userId = Integer.parseInt(ctx.pathParam("id"));
        JsonObject body = ctx.body().asJsonObject();
        String username = body.getString("username");
        String role = body.getString("role");
        Integer score = body.getInteger("score") != null ? body.getInteger("score") : 0;
        String status = body.getString("status") != null ? body.getString("status") : "ausstehend";

        dbClient.preparedQuery("UPDATE users SET username = ?, role = ?, score = ?, status = ? WHERE id = ?")
            .execute(Tuple.of(username, role, score, status, userId))
            .onSuccess(res -> ctx.response().end("Updated"))
            .onFailure(err -> ctx.response().setStatusCode(500).end(err.getMessage()));
    }

    public void updateStatus(RoutingContext ctx) {
        int userId = Integer.parseInt(ctx.pathParam("id"));
        JsonObject body = ctx.body() != null ? ctx.body().asJsonObject() : null;
        String status = body != null ? body.getString("status") : null;

        if (status == null || status.isBlank()) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Status fehlt.").encode());
            return;
        }

        status = status.trim().toLowerCase();
        if (!status.equals("bereit")
                && !status.equals("ausstehend")
                && !status.equals("spielend")) {
            ctx.response().setStatusCode(400)
                .putHeader("Content-Type", "application/json")
                .end(new JsonObject().put("error", "Ungültiger Status.").encode());
            return;
        }

        final String finalStatus = status;

        dbClient.preparedQuery("UPDATE users SET status = ? WHERE id = ?")
            .execute(Tuple.of(finalStatus, userId))
            .onSuccess(result -> {
                if (result.rowCount() == 0) {
                    ctx.response().setStatusCode(404)
                        .putHeader("Content-Type", "application/json")
                        .end(new JsonObject().put("error", "Spieler nicht gefunden.").encode());
                    return;
                }

                dbClient.preparedQuery("SELECT id, username, role, score, status FROM users WHERE id = ?")
                    .execute(Tuple.of(userId))
                    .onSuccess(rows -> {
                        var row = rows.iterator().next();
                        JsonObject response = new JsonObject()
                            .put("success", true)
                            .put("id", row.getInteger("id"))
                            .put("username", row.getString("username"))
                            .put("role", row.getString("role"))
                            .put("score", row.getInteger("score") == null ? 0 : row.getInteger("score"))
                            .put("status", row.getString("status"));

                        ctx.response().setStatusCode(200)
                            .putHeader("Cache-Control", "no-store")
                            .putHeader("Content-Type", "application/json")
                            .end(response.encode());
                    })
                    .onFailure(err -> ctx.response().setStatusCode(500).end(err.getMessage()));
            })
            .onFailure(err -> ctx.response().setStatusCode(500).end(err.getMessage()));
    }
}
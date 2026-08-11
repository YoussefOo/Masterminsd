package de.thm.codecracker.game;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.RoutingContext;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Tuple;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

/** Server-authoritative Mastermind state. Game-ID is the shared identity of a match. */
public class GameController {
    private static final int MAX_ROUNDS = 10;
    private static final long ROUND_DURATION_MS = 30_000L;
    private static final List<String> COLORS = List.of("red", "blue", "green", "yellow");
    private static final long INVITATION_DURATION_MS = 30_000L;
    private final Map<String, InvitationGroup> invitations = new ConcurrentHashMap<>();

    private final Pool dbClient;
    private final Map<String, GameState> games = new ConcurrentHashMap<>();

    public GameController(Pool dbClient) { this.dbClient = dbClient; }


    /** Create one invitation group. All recipients receive an independent invitation,
     *  but the first acceptance wins the match. Refreshing a dashboard never removes it.
     */
    public void createInvitations(RoutingContext ctx) {
        JsonObject body = ctx.body() == null ? null : ctx.body().asJsonObject();
        String from = body != null ? body.getString("from") : null;
        JsonArray recipients = body != null ? body.getJsonArray("recipients") : null;
        if (from == null || from.isBlank() || recipients == null || recipients.isEmpty()) {
            ctx.response().setStatusCode(400).end(error("Einladender Spieler und mindestens ein Empfänger sind erforderlich."));
            return;
        }

        long now = System.currentTimeMillis();
        String groupId = "invite_" + now + "_" + UUID.randomUUID().toString().substring(0, 8);
        InvitationGroup group = new InvitationGroup(groupId, from, now + INVITATION_DURATION_MS);

        Set<String> unique = new HashSet<>();
        for (Object raw : recipients) {
            String to = String.valueOf(raw);
            if (!to.isBlank() && !to.equals(from)) unique.add(to);
        }
        if (unique.isEmpty()) {
            ctx.response().setStatusCode(400).end(error("Mindestens ein anderer Spieler muss ausgewählt werden."));
            return;
        }
        for (String to : unique) {
            Invitation invitation = new Invitation(groupId, from, to, group.expiresAt);
            group.invitations.put(invitation.id, invitation);
        }
        invitations.put(groupId, group);
        ctx.response().putHeader("Cache-Control", "no-store").putHeader("Content-Type", "application/json")
            .end(invitationGroupJson(group).encode());
    }

    /** Return incoming and outgoing invitations for a player. Expiry is server-side. */
    public void getInvitations(RoutingContext ctx) {
        String username = ctx.request().getParam("user");
        if (username == null || username.isBlank()) {
            ctx.response().setStatusCode(400).end(error("Benutzer fehlt."));
            return;
        }
        long now = System.currentTimeMillis();
        JsonArray incoming = new JsonArray();
        JsonArray outgoing = new JsonArray();

        for (InvitationGroup group : invitations.values()) {
            synchronized (group) {
                if (!group.resolved && now >= group.expiresAt) resolveGroup(group, "EXPIRED");
                // Incoming invitations disappear after the recipient responds.
                // The sender keeps the invitation group visible until its original
                // 30-second deadline, so a dashboard refresh never loses the invitation.
                for (Invitation inv : group.invitations.values()) {
                    if (inv.to.equals(username) && !group.resolved && "PENDING".equals(inv.status)) {
                        incoming.add(invitationJson(inv, group));
                    }
                    if (group.from.equals(username) && now < group.expiresAt) {
                        outgoing.add(invitationJson(inv, group));
                    }
                }
            }
        }
        JsonObject response = new JsonObject()
            .put("incoming", incoming)
            .put("outgoing", outgoing);
        ctx.response().putHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            .putHeader("Pragma", "no-cache").putHeader("Content-Type", "application/json").end(response.encode());
    }

    /** Each recipient can accept/reject only their own invitation. */
    public void respondToInvitation(RoutingContext ctx) {
        String invitationId = ctx.pathParam("invitationId");
        JsonObject body = ctx.body() == null ? null : ctx.body().asJsonObject();
        String username = body != null ? body.getString("username") : null;
        String action = body != null ? body.getString("action") : null;
        if (invitationId == null || username == null || action == null) {
            ctx.response().setStatusCode(400).end(error("Einladung, Benutzer und Aktion sind erforderlich."));
            return;
        }

        InvitationGroup found = null;
        Invitation target = null;
        for (InvitationGroup group : invitations.values()) {
            synchronized (group) {
                Invitation inv = group.invitations.get(invitationId);
                if (inv != null) { found = group; target = inv; break; }
            }
        }
        if (found == null || target == null) {
            ctx.response().setStatusCode(404).end(error("Einladung nicht gefunden."));
            return;
        }

        synchronized (found) {
            if (found.resolved || !"PENDING".equals(target.status)) {
                ctx.response().setStatusCode(409).end(error("Diese Einladung ist nicht mehr aktiv."));
                return;
            }
            if (!target.to.equals(username)) {
                ctx.response().setStatusCode(403).end(error("Du darfst nur deine eigene Einladung beantworten."));
                return;
            }
            if (System.currentTimeMillis() >= found.expiresAt) {
                resolveGroup(found, "EXPIRED");
                ctx.response().setStatusCode(410).end(error("Die 30 Sekunden sind abgelaufen."));
                return;
            }

            if ("REJECT".equalsIgnoreCase(action)) {
                target.status = "REJECTED";
                boolean allRejected = found.invitations.values().stream().allMatch(i -> "REJECTED".equals(i.status));
                if (allRejected) resolveGroup(found, "ALL_REJECTED");
                ctx.response().putHeader("Content-Type", "application/json").end(invitationGroupJson(found).encode());
                return;
            }

            if (!"ACCEPT".equalsIgnoreCase(action)) {
                ctx.response().setStatusCode(400).end(error("Ungültige Aktion."));
                return;
            }

            // First acceptance wins. Every other pending invitation is cancelled,
            // while a previous rejection can never be undone by another player.
            target.status = "ACCEPTED";
            found.resolved = true;
            found.resolution = "ACCEPTED";
            for (Invitation inv : found.invitations.values()) {
                if (inv != target && "PENDING".equals(inv.status)) inv.status = "CANCELLED";
            }

            // Java lambdas require captured local variables to be final/effectively final.
            // Keep the resolved invitation/group references stable for both callbacks.
            final InvitationGroup foundGroup = found;
            final Invitation targetInvitation = target;

            createGameInternal(foundGroup.from, targetInvitation.to, game -> {
                foundGroup.gameId = game.gameId;
                ctx.response().putHeader("Content-Type", "application/json")
                    .end(invitationGroupJson(foundGroup).encode());
            }, err -> {
                foundGroup.resolved = false;
                targetInvitation.status = "PENDING";
                for (Invitation inv : foundGroup.invitations.values()) {
                    if ("CANCELLED".equals(inv.status)) inv.status = "PENDING";
                }
                ctx.response().setStatusCode(500).end(error("Spiel konnte nicht gestartet werden."));
            });
        }
    }

    private void resolveGroup(InvitationGroup group, String reason) {
        group.resolved = true;
        group.resolution = reason;
        if (!"ACCEPTED".equals(reason)) {
            for (Invitation inv : group.invitations.values()) {
                if ("PENDING".equals(inv.status)) inv.status = "EXPIRED";
            }
        }
    }

    private JsonObject invitationJson(Invitation inv, InvitationGroup group) {
        long remaining = Math.max(0, group.expiresAt - System.currentTimeMillis());
        return new JsonObject()
            .put("invitationId", inv.id)
            .put("groupId", group.groupId)
            .put("from", group.from)
            .put("to", inv.to)
            .put("status", inv.status)
            .put("expiresAt", group.expiresAt)
            .put("remainingMs", remaining)
            .put("resolution", group.resolution)
            .put("gameId", group.gameId);
    }

    private JsonObject invitationGroupJson(InvitationGroup group) {
        JsonArray items = new JsonArray();
        for (Invitation inv : group.invitations.values()) items.add(invitationJson(inv, group));
        return new JsonObject().put("groupId", group.groupId).put("from", group.from)
            .put("expiresAt", group.expiresAt).put("resolved", group.resolved)
            .put("resolution", group.resolution).put("gameId", group.gameId).put("invitations", items);
    }

    private void createGameInternal(String p1, String p2, java.util.function.Consumer<GameState> success,
                                     java.util.function.Consumer<Throwable> failure) {
        String id = "game_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8);
        List<String> secret = new ArrayList<>();
        for (int i = 0; i < 4; i++) secret.add(COLORS.get(ThreadLocalRandom.current().nextInt(COLORS.size())));
        GameState game = new GameState(id, p1, p2, secret);
        games.put(id, game);
        dbClient.preparedQuery("UPDATE users SET status = 'spielend' WHERE username IN (?, ?)")
            .execute(Tuple.of(p1, p2))
            .onSuccess(ignored -> success.accept(game))
            .onFailure(err -> failure.accept(err));
    }

    /** Admin-only live view of all currently running matches.
     *  Every active game is shown independently, including its server-generated
     *  secret code. Finished games never expose their previous secret code.
     */
    public void getAdminGameStatus(RoutingContext ctx) {
        List<GameState> activeGames = new ArrayList<>();
        GameState latestFinished = null;

        for (GameState game : games.values()) {
            synchronized (game) {
                if (!game.finished) {
                    activeGames.add(game);
                } else if (latestFinished == null || game.createdAt > latestFinished.createdAt) {
                    latestFinished = game;
                }
            }
        }

        activeGames.sort((a, b) -> Long.compare(b.createdAt, a.createdAt));
        JsonArray active = new JsonArray();
        for (GameState game : activeGames) {
            synchronized (game) {
                active.add(adminActiveGameJson(game));
            }
        }

        JsonObject response = new JsonObject()
            .put("active", !activeGames.isEmpty())
            .put("activeGames", active);

        if (latestFinished != null) {
            synchronized (latestFinished) {
                response.put("hasLastResult", true)
                    .put("lastResult", new JsonObject()
                        .put("gameId", latestFinished.gameId)
                        .put("player1", latestFinished.player1)
                        .put("player2", latestFinished.player2)
                        .put("winner", latestFinished.winner)
                        .put("loser", latestFinished.loser)
                        .put("aborted", latestFinished.abortedBy != null)
                        .put("abortedBy", latestFinished.abortedBy)
                        .put("finished", true)
                        .put("status", "FINISHED"))
                    // Backward-compatible fields for the existing admin page.
                    .put("gameId", latestFinished.gameId)
                    .put("player1", latestFinished.player1)
                    .put("player2", latestFinished.player2)
                    .put("winner", latestFinished.winner)
                    .put("loser", latestFinished.loser)
                    .put("aborted", latestFinished.abortedBy != null)
                    .put("abortedBy", latestFinished.abortedBy)
                    .put("finished", true)
                    .put("status", "FINISHED");
            }
        } else {
            response.put("hasLastResult", false);
        }

        ctx.response()
            .putHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            .putHeader("Pragma", "no-cache")
            .putHeader("Content-Type", "application/json")
            .end(response.encode());
    }

    private JsonObject adminActiveGameJson(GameState game) {
        JsonObject scores = new JsonObject()
            .put(game.player1, game.scores.getOrDefault(game.player1, 0))
            .put(game.player2, game.scores.getOrDefault(game.player2, 0));
        String currentRoundPlayers = game.roundCorrect.getOrDefault(game.round, Map.of()).keySet().stream().findFirst().orElse(null);
        return new JsonObject()
            .put("active", true)
            .put("gameId", game.gameId)
            .put("player1", game.player1)
            .put("player2", game.player2)
            .put("round", game.round)
            .put("currentPlayer", game.currentPlayer())
            .put("roundStartTime", game.roundStartTime)
            .put("roundDurationMs", ROUND_DURATION_MS)
            .put("secretCode", new JsonArray(game.secretCode))
            .put("secretCodeText", String.join(",", game.secretCode))
            .put("roundSubmittedBy", currentRoundPlayers)
            .put("roundSubmittedCount", game.roundCorrect.getOrDefault(game.round, Map.of()).size())
            .put("scores", scores)
            .put("status", "RUNNING");
    }

    /** Return all currently running games so every lobby can show which players are playing.
     *  This endpoint intentionally does not expose the secret code or private history beyond
     *  the normal state fields already used by the lobby banner.
     */
    public void getActiveGames(RoutingContext ctx) {
        // Only expose games that are genuinely running in the database.
        // This prevents stale in-memory games from appearing in a fresh lobby
        // when neither player is actually playing anymore.
        List<GameState> candidates = new ArrayList<>();
        for (GameState game : games.values()) {
            synchronized (game) {
                if (!game.finished) {
                    candidates.add(game);
                }
            }
        }

        if (candidates.isEmpty()) {
            ctx.response().putHeader("Content-Type", "application/json")
                .end(new JsonArray().encode());
            return;
        }

        JsonArray active = new JsonArray();
        checkActiveGameCandidate(candidates, 0, active, ctx);
    }

    private void checkActiveGameCandidate(List<GameState> candidates, int index, JsonArray active, RoutingContext ctx) {
        if (index >= candidates.size()) {
            ctx.response().putHeader("Content-Type", "application/json").end(active.encode());
            return;
        }

        GameState game = candidates.get(index);
        String sql = "SELECT COUNT(*) AS playing_count FROM users WHERE username IN (?, ?) AND status = 'spielend'";
        dbClient.preparedQuery(sql).execute(Tuple.of(game.player1, game.player2))
            .onSuccess(rows -> {
                int playingCount = rows.iterator().hasNext() ? rows.iterator().next().getInteger("playing_count") : 0;
                synchronized (game) {
                    if (!game.finished && playingCount == 2) {
                        active.add(lobbyGameJson(game));
                    }
                }
                checkActiveGameCandidate(candidates, index + 1, active, ctx);
            })
            .onFailure(err -> {
                // If the database cannot confirm the players are currently playing,
                // do not show the game to other lobby users.
                checkActiveGameCandidate(candidates, index + 1, active, ctx);
            });
    }

    public void getActiveGameForPlayer(RoutingContext ctx) {
        String username = ctx.pathParam("username");
        for (GameState game : games.values()) {
            synchronized (game) {
                if (!game.finished && game.players().contains(username)) {
                    ctx.response().putHeader("Content-Type", "application/json").end(stateJson(game).encode());
                    return;
                }
            }
        }
        ctx.response().setStatusCode(404).end(error("Kein aktives Spiel."));
    }

    private JsonObject lobbyGameJson(GameState game) {
        return new JsonObject()
            .put("gameId", game.gameId)
            .put("player1", game.player1)
            .put("player2", game.player2)
            .put("players", new JsonArray(List.of(game.player1, game.player2)))
            .put("round", game.round)
            .put("currentPlayer", game.currentPlayer())
            .put("roundStartTime", game.roundStartTime)
            .put("roundDurationMs", ROUND_DURATION_MS)
            .put("finished", game.finished);
    }

    public void getGame(RoutingContext ctx) {
        GameState game = games.get(ctx.pathParam("gameId"));
        if (game == null) { ctx.response().setStatusCode(404).end(error("Spiel nicht gefunden.")); return; }
        synchronized (game) {
            if (!game.finished && isTimedOut(game)) advanceOrFinishTimeout(game);
            ctx.response().putHeader("Content-Type", "application/json").end(stateJson(game).encode());
        }
    }

    public void submitGuess(RoutingContext ctx) {
        GameState game = games.get(ctx.pathParam("gameId"));
        if (game == null) { ctx.response().setStatusCode(404).end(error("Spiel nicht gefunden.")); return; }
        JsonObject body = ctx.body().asJsonObject();
        String player = body != null ? body.getString("player") : null;
        JsonArray arr = body != null ? body.getJsonArray("guess") : null;
        if (player == null || arr == null || arr.size() != 4) {
            ctx.response().setStatusCode(400).end(error("Spieler und genau 4 Farben sind erforderlich.")); return;
        }
        List<String> guess = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            String c = arr.getString(i);
            if (!COLORS.contains(c)) { ctx.response().setStatusCode(400).end(error("Ungültige Farbe.")); return; }
            guess.add(c);
        }

        synchronized (game) {
            if (game.finished) { ctx.response().setStatusCode(409).end(stateJson(game).put("message", "Das Spiel ist bereits beendet.").encode()); return; }
            if (!game.players().contains(player)) { ctx.response().setStatusCode(403).end(error("Du bist nicht Teil dieses Spiels.")); return; }
            if (isTimedOut(game)) {
                advanceOrFinishTimeout(game);
                ctx.response().putHeader("Content-Type", "application/json").end(stateJson(game).put("timeout", true).encode());
                return;
            }
            if (!game.currentPlayer().equals(player)) {
                ctx.response().setStatusCode(409).end(stateJson(game).put("message", "Du bist nicht am Zug.").encode()); return;
            }

            int black = 0, white = 0;
            List<String> secret = new ArrayList<>(game.secretCode);
            List<String> attempt = new ArrayList<>(guess);
            for (int i = 0; i < 4; i++) {
                if (attempt.get(i).equals(secret.get(i))) {
                    black++; secret.set(i, null); attempt.set(i, null);
                }
            }
            for (int i = 0; i < 4; i++) {
                String value = attempt.get(i);
                if (value != null) {
                    int found = secret.indexOf(value);
                    if (found >= 0) { white++; secret.set(found, null); }
                }
            }

            JsonObject history = new JsonObject()
                .put("player", player).put("round", game.round)
                .put("guess", new JsonArray(guess)).put("blackPins", black).put("whitePins", white)
                .put("time", System.currentTimeMillis());
            game.history.computeIfAbsent(player, ignored -> new ArrayList<>()).add(history);

            // A round is only decided after BOTH players have submitted their attempt.
            // The first correct answer never ends the game by itself.
            Map<String, Boolean> submissions = game.roundCorrect.computeIfAbsent(game.round, ignored -> new LinkedHashMap<>());
            submissions.put(player, black == 4);

            final int finalBlackPins = black;
            final int finalWhitePins = white;

            if (submissions.size() == 2) {
                boolean p1Correct = submissions.getOrDefault(game.player1, false);
                boolean p2Correct = submissions.getOrDefault(game.player2, false);

                if (p1Correct && p2Correct) {
                    // Both solved the same round: draw, +1 each, then finish the game.
                    // Use an explicit DRAW marker so the result page can render the draw correctly.
                    game.winner = "DRAW";
                    game.loser = null;
                    persistDraw(game, () -> {
                        JsonObject response = stateJson(game).put("accepted", true).put("finished", true)
                            .put("draw", true).put("blackPins", finalBlackPins).put("whitePins", finalWhitePins)
                            .put("historyEntry", history);
                        ctx.response().putHeader("Content-Type", "application/json").end(response.encode());
                    });
                    return;
                }

                if (p1Correct || p2Correct) {
                    game.winner = p1Correct ? game.player1 : game.player2;
                    game.loser = p1Correct ? game.player2 : game.player1;
                    persistFinish(game, 3, -1, () -> {
                        JsonObject response = stateJson(game).put("accepted", true).put("finished", true)
                            .put("blackPins", finalBlackPins).put("whitePins", finalWhitePins)
                            .put("historyEntry", history);
                        ctx.response().putHeader("Content-Type", "application/json").end(response.encode());
                    });
                    return;
                }

                // Both were wrong: the round is over and the next round starts.
                advanceTurn(game);
            } else {
                // First player has answered; give the other player the same round.
                advanceTurn(game);
            }

            JsonObject response = stateJson(game).put("accepted", true).put("finished", game.finished)
                .put("blackPins", black).put("whitePins", white).put("historyEntry", history);
            ctx.response().putHeader("Content-Type", "application/json").end(response.encode());
        }
    }

    public void abort(RoutingContext ctx) {
        GameState game = games.get(ctx.pathParam("gameId"));
        if (game == null) { ctx.response().setStatusCode(404).end(error("Spiel nicht gefunden.")); return; }
        String player = ctx.request().getParam("player");
        synchronized (game) {
            if (!game.players().contains(player)) { ctx.response().setStatusCode(403).end(error("Du bist nicht Teil dieses Spiels.")); return; }
            if (!game.finished) {
                // The player who aborts loses 1 point; the other player wins 3 points.
                game.abortedBy = player;
                game.loser = player;
                game.winner = game.players().stream()
                    .filter(p -> !p.equals(player))
                    .findFirst()
                    .orElse(null);
                persistFinish(game, 3, -1, () ->
                    ctx.response().putHeader("Content-Type", "application/json").end(stateJson(game).encode())
                );
                return;
            }
            ctx.response().putHeader("Content-Type", "application/json").end(stateJson(game).encode());
        }
    }

    public void timeout(RoutingContext ctx) {
        GameState game = games.get(ctx.pathParam("gameId"));
        if (game == null) { ctx.response().setStatusCode(404).end(error("Spiel nicht gefunden.")); return; }
        synchronized (game) {
            if (!game.finished && isTimedOut(game)) advanceOrFinishTimeout(game);
            ctx.response().putHeader("Content-Type", "application/json").end(stateJson(game).encode());
        }
    }

    private boolean isTimedOut(GameState game) { return System.currentTimeMillis() - game.roundStartTime >= ROUND_DURATION_MS; }

    private void advanceOrFinishTimeout(GameState game) {
        if (game.currentPlayerIndex == 1) {
            game.round++;
            if (game.round > MAX_ROUNDS) {
                game.winner = "ALL_LOST";
                persistFinish(game, -1, -1, null);
                return;
            }
        }
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % 2;
        game.roundStartTime = System.currentTimeMillis();
    }

    private void advanceTurn(GameState game) {
        game.currentPlayerIndex++;
        if (game.currentPlayerIndex >= 2) {
            game.currentPlayerIndex = 0;
            game.round++;
            if (game.round > MAX_ROUNDS) {
                game.winner = "ALL_LOST";
                persistFinish(game, -1, -1, null);
                return;
            }
        }
        game.roundStartTime = System.currentTimeMillis();
    }

    /** Persist a draw: both players receive +1 and both return to the lobby. */
    private void persistDraw(GameState game, Runnable callback) {
        if (game.finished) { if (callback != null) loadScores(game, callback); return; }
        game.finished = true;
        String sql = "UPDATE users SET score = score + 1, status = 'ausstehend' WHERE username = ?";
        dbClient.preparedQuery(sql).execute(Tuple.of(game.player1))
            .compose(ignored -> dbClient.preparedQuery(sql).execute(Tuple.of(game.player2)))
            .onSuccess(ignored -> loadScores(game, callback))
            .onFailure(err -> { game.dbError = err.getMessage(); if (callback != null) callback.run(); });
    }

    /** Persist points and reset both players to the lobby. Called once per Game-ID. */
    private void persistFinish(GameState game, int winnerDelta, int loserDelta, Runnable callback) {
        if (game.finished) { if (callback != null) loadScores(game, callback); return; }
        game.finished = true;
        String sql = "UPDATE users SET score = GREATEST(score + ?, 0), status = 'ausstehend' WHERE username = ?";
        int p1Delta = deltaFor(game, game.player1, winnerDelta, loserDelta);
        int p2Delta = deltaFor(game, game.player2, winnerDelta, loserDelta);
        dbClient.preparedQuery(sql).execute(Tuple.of(p1Delta, game.player1))
            .compose(ignored -> dbClient.preparedQuery(sql).execute(Tuple.of(p2Delta, game.player2)))
            .onSuccess(ignored -> loadScores(game, callback))
            .onFailure(err -> { game.dbError = err.getMessage(); if (callback != null) callback.run(); });
    }

    private int deltaFor(GameState game, String player, int winnerDelta, int loserDelta) {
        if ("ALL_LOST".equals(game.winner)) return -1;
        return player.equals(game.winner) ? winnerDelta : loserDelta;
    }

    private void loadScores(GameState game, Runnable callback) {
        dbClient.preparedQuery("SELECT username, score, status FROM users WHERE username IN (?, ?)")
            .execute(Tuple.of(game.player1, game.player2))
            .onSuccess(rows -> {
                for (var row : rows) {
                    game.scores.put(row.getString("username"), row.getInteger("score") == null ? 0 : row.getInteger("score"));
                    game.statuses.put(row.getString("username"), row.getString("status"));
                }
                if (callback != null) callback.run();
            })
            .onFailure(err -> { game.dbError = err.getMessage(); if (callback != null) callback.run(); });
    }

    private JsonObject stateJson(GameState game) {
        JsonObject json = new JsonObject()
            .put("gameId", game.gameId).put("player1", game.player1).put("player2", game.player2)
            .put("players", new JsonArray(List.of(game.player1, game.player2)))
            .put("round", game.round).put("currentPlayerIndex", game.currentPlayerIndex)
            .put("currentPlayer", game.currentPlayer()).put("roundStartTime", game.roundStartTime)
            .put("roundDurationMs", ROUND_DURATION_MS).put("status", game.finished ? "FINISHED" : "RUNNING")
            .put("finished", game.finished).put("winner", game.winner).put("loser", game.loser)
            .put("aborted", game.abortedBy != null).put("abortedBy", game.abortedBy)
            .put("history", historyJson(game));
        JsonObject scores = new JsonObject().put(game.player1, game.scores.getOrDefault(game.player1, 0))
            .put(game.player2, game.scores.getOrDefault(game.player2, 0));
        json.put("scores", scores);
        if (game.dbError != null) json.put("dbError", game.dbError);
        return json;
    }

    private JsonObject historyJson(GameState game) {
        JsonObject all = new JsonObject();
        game.history.forEach((player, entries) -> all.put(player, new JsonArray(entries)));
        return all;
    }

    private String error(String message) { return new JsonObject().put("error", message).encode(); }

    private static final class GameState {
        final String gameId, player1, player2;
        final long createdAt;
        final List<String> secretCode;
        final Map<String, List<JsonObject>> history = new LinkedHashMap<>();
        final Map<String, Integer> scores = new LinkedHashMap<>();
        final Map<String, String> statuses = new LinkedHashMap<>();
        final Map<Integer, Map<String, Boolean>> roundCorrect = new LinkedHashMap<>();
        int round = 1, currentPlayerIndex = 0;
        long roundStartTime = System.currentTimeMillis();
        boolean finished = false;
        String winner, loser, abortedBy, dbError;

        GameState(String id, String p1, String p2, List<String> secret) { gameId = id; player1 = p1; player2 = p2; createdAt = System.currentTimeMillis(); secretCode = secret; }
        List<String> players() { return List.of(player1, player2); }
        String currentPlayer() { return currentPlayerIndex == 0 ? player1 : player2; }
    }

    private static final class InvitationGroup {
        final String groupId;
        final String from;
        final long expiresAt;
        final Map<String, Invitation> invitations = new LinkedHashMap<>();
        boolean resolved;
        String resolution = "PENDING";
        String gameId;
        InvitationGroup(String groupId, String from, long expiresAt) {
            this.groupId = groupId; this.from = from; this.expiresAt = expiresAt;
        }
    }

    private static final class Invitation {
        final String id = "inv_" + UUID.randomUUID().toString().substring(0, 8);
        final String groupId;
        final String from;
        final String to;
        final long expiresAt;
        String status = "PENDING";
        Invitation(String groupId, String from, String to, long expiresAt) {
            this.groupId = groupId; this.from = from; this.to = to; this.expiresAt = expiresAt;
        }
    }

}

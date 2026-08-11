package de.thm.codecracker;


import de.thm.codecracker.auth.AuthController;

import de.thm.codecracker.auth.AdminController;

import de.thm.codecracker.config.AppConfig;

import de.thm.codecracker.config.DatabaseConfig;

import de.thm.codecracker.todo.TodoController;

import de.thm.codecracker.todo.TodoService;

import de.thm.codecracker.todo.TodoRepository;

import de.thm.codecracker.todo.TodoWebSocketController;
import de.thm.codecracker.game.GameController;

import io.vertx.core.AbstractVerticle;

import io.vertx.core.http.HttpMethod;

import io.vertx.ext.web.Router;

import io.vertx.ext.web.handler.BodyHandler;

import io.vertx.ext.web.handler.CorsHandler;

import io.vertx.ext.web.handler.LoggerFormat;

import io.vertx.ext.web.handler.LoggerHandler;

import io.vertx.ext.web.handler.StaticHandler;

import org.slf4j.Logger;

import org.slf4j.LoggerFactory;


public class MainVerticle extends AbstractVerticle {

private static final Logger LOGGER = LoggerFactory.getLogger(MainVerticle.class);


@Override

public void start() {

var config = AppConfig.fromEnvironment();

var pool = DatabaseConfig.createPool(vertx, config);


var authController = new AuthController(pool);

var adminController = new AdminController(pool);
var gameController = new GameController(pool);


var todoRepository = new TodoRepository(pool);

var todoService = new TodoService(todoRepository, vertx);

var todoController = new TodoController(todoService);


var todoWebSocketController = new TodoWebSocketController(vertx, todoService);

todoWebSocketController.registerEventBusConsumer();


Router router = Router.router(vertx);

router.route().handler(LoggerHandler.create(LoggerFormat.DEFAULT));

router.route().handler(BodyHandler.create());


// تفعيل CORS

router.route().handler(CorsHandler.create()

.addOrigin("*")

.allowedMethod(HttpMethod.GET)

.allowedMethod(HttpMethod.POST)

.allowedMethod(HttpMethod.PUT)

.allowedMethod(HttpMethod.DELETE)

.allowedHeader("Authorization")

.allowedHeader("Content-Type")

);


// Auth Routes

router.post("/api/login").handler(authController::handleLogin);

router.post("/api/register").handler(authController::handleRegister);


// Admin & Game CRUD Routes

router.get("/api/admin/users").handler(adminController::getAllUsers);

router.delete("/api/admin/users/:id").handler(adminController::deleteUser);

router.put("/api/admin/users/:id").handler(adminController::updateUser);

// الراوت الجديد لتحديث حالة اللاعب (Bereit / Ausstehend)

router.put("/api/admin/users/:id/status").handler(adminController::updateStatus);

// Server-authoritative Game-ID based matchmaking/game state
        router.post("/api/game/invitations").handler(gameController::createInvitations);
        router.get("/api/game/invitations").handler(gameController::getInvitations);
        router.post("/api/game/invitations/:invitationId/respond").handler(gameController::respondToInvitation);
router.get("/api/game/active").handler(gameController::getActiveGames);
router.get("/api/admin/game/status").handler(gameController::getAdminGameStatus);
router.get("/api/game/player/:username").handler(gameController::getActiveGameForPlayer);
router.get("/api/game/:gameId").handler(gameController::getGame);
router.post("/api/game/:gameId/guess").handler(gameController::submitGuess);
router.post("/api/game/:gameId/timeout").handler(gameController::timeout);
router.post("/api/game/:gameId/abort").handler(gameController::abort);


todoController.registerRoutes(router);

todoWebSocketController.registerRoutes(router);


router.get("/").handler(ctx ->

ctx.response().setStatusCode(302).putHeader("Location", "/pages/login.html").end()

);


router.route("/*").handler(StaticHandler.create("webroot"));


var server = vertx.createHttpServer();

server.requestHandler(router);

server.listen(config.httpPort()).await();


LOGGER.info("Server started on port {}", config.httpPort());

}

}

package de.thm.codecracker.auth;

import de.thm.codecracker.user.UserRepository;
import de.thm.codecracker.user.model.User;
import io.vertx.core.Future;
import io.vertx.core.json.JsonObject;

public class AuthService {
  private final UserRepository userRepository;

  public AuthService(UserRepository userRepository) {
    this.userRepository = userRepository;
  }

  public Future<JsonObject> login(String username, String password) {
    return userRepository.findByUsername(username).compose(user -> {
      if (user == null || !password.equals(user.passwordHash())) {
        return Future.failedFuture("Ungültige Anmeldedaten");
      }
      return Future.succeededFuture(user.toResponseJson());
    });
  }

  public Future<JsonObject> register(String username, String password) {
    return userRepository.findByUsername(username).compose(existing -> {
      if (existing != null) {
        return Future.failedFuture("Benutzername bereits vergeben!");
      }
      return userRepository.save(username, password, "PLAYER")
        .compose(id -> login(username, password));
    });
  }
}
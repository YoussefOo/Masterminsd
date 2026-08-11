
package de.thm.codecracker.user.model;

import io.vertx.core.json.JsonObject;

public record User(Integer id, String username, String passwordHash, String role) {

  public JsonObject toResponseJson() {
    return new JsonObject()
      .put("id", id)
      .put("username", username)
      .put("role", role);
  }
}
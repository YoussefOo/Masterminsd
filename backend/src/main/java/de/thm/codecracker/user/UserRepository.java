package de.thm.codecracker.user;

import de.thm.codecracker.user.model.User;
import io.vertx.core.Future;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.Tuple;
import java.util.ArrayList;
import java.util.List;

public class UserRepository {
  private final Pool pool;

  public UserRepository(Pool pool) {
    this.pool = pool;
  }

  // CREATE
  public Future<Integer> save(String username, String passwordHash, String role) {
    String sql = "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)";
    return pool.preparedQuery(sql)
      .execute(Tuple.of(username, passwordHash, role))
      .map(res -> res.property(io.vertx.mysqlclient.MySQLClient.LAST_INSERTED_ID).intValue());
  }

  // READ (Single by Username)
  public Future<User> findByUsername(String username) {
    String sql = "SELECT id, username, password_hash, role FROM users WHERE username = ?";
    return pool.preparedQuery(sql)
      .execute(Tuple.of(username))
      .map(rows -> {
        if (!rows.iterator().hasNext()) return null;
        var row = rows.iterator().next();
        return new User(row.getInteger("id"), row.getString("username"), row.getString("password_hash"), row.getString("role"));
      });
  }

  // READ (All Users - CRUD)
  public Future<List<User>> findAll() {
    String sql = "SELECT id, username, password_hash, role FROM users";
    return pool.preparedQuery(sql).execute().map(rows -> {
      List<User> users = new ArrayList<>();
      rows.forEach(row -> users.add(new User(row.getInteger("id"), row.getString("username"), "", row.getString("role"))));
      return users;
    });
  }

  // DELETE (CRUD)
  public Future<Boolean> deleteById(int id) {
    String sql = "DELETE FROM users WHERE id = ?";
    return pool.preparedQuery(sql).execute(Tuple.of(id)).map(res -> res.rowCount() > 0);
  }
}
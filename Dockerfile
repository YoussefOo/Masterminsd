# 1. Frontend bauen
FROM node:22 AS frontend-build
WORKDIR /frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend .
# Some environments preserve the Vite CLI without executable permissions.
# Normalize the CLI permissions before running the unchanged build command.
RUN chmod +x node_modules/.bin/vite node_modules/vite/bin/vite.js && npm run build


# 2. Vert.x Backend bauen
FROM maven:3.9-eclipse-temurin-21 AS backend-build
WORKDIR /backend

COPY backend/pom.xml ./
RUN mvn dependency:go-offline

COPY backend/src ./src
RUN mvn clean package -DskipTests


# 3. Runtime Image
FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=backend-build /backend/target/*-fat.jar app.jar
COPY --from=frontend-build /frontend/dist ./webroot

EXPOSE 8080

CMD ["java", "-jar", "app.jar"]

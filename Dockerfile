FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /workspace
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
COPY src/main/ src/main/
RUN chmod +x mvnw \
    && ./mvnw --batch-mode --no-transfer-progress -Dmaven.test.skip=true package

FROM eclipse-temurin:21-jre-jammy AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/target/*.jar /app/application.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/application.jar"]

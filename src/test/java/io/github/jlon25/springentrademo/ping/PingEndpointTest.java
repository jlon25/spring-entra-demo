package io.github.jlon25.springentrademo.ping;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PingEndpointTest {

    @LocalServerPort
    private int port;

    @Test
    void pingReturnsPongAsJsonWithoutAuthentication() throws Exception {
        HttpResponse<String> response = get("/public/ping");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type")).hasValueSatisfying(
                contentType -> assertThat(contentType).startsWith("application/json"));
        assertThat(response.body()).isEqualTo("{\"message\":\"pong\"}");
    }

    @Test
    void unknownRouteReturnsNotFound() throws Exception {
        HttpResponse<String> response = get("/public/does-not-exist");

        assertThat(response.statusCode()).isEqualTo(404);
    }

    private HttpResponse<String> get(String path) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(10))
                .GET()
                .build();
        try (HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build()) {
            return client.send(request, HttpResponse.BodyHandlers.ofString());
        }
    }
}

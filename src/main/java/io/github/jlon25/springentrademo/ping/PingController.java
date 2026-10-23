package io.github.jlon25.springentrademo.ping;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PingController {

    @GetMapping(path = "/public/ping", produces = MediaType.APPLICATION_JSON_VALUE)
    public PingResponse ping() {
        return new PingResponse("pong");
    }

    public record PingResponse(String message) {
    }
}

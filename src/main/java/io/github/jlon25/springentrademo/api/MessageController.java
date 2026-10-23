package io.github.jlon25.springentrademo.api;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MessageController {

    @GetMapping(path = "/api/message", produces = MediaType.APPLICATION_JSON_VALUE)
    public MessageResponse message() {
        return new MessageResponse("authenticated");
    }

    public record MessageResponse(String message) {
    }
}

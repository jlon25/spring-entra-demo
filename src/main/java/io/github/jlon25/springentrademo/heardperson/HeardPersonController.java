package io.github.jlon25.springentrademo.heardperson;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Profile("postgres")
@RequestMapping(path = "/api/heard-persons", produces = MediaType.APPLICATION_JSON_VALUE)
public class HeardPersonController {

    private final HeardPersonRepository repository;

    public HeardPersonController(HeardPersonRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<HeardPerson> list() {
        return repository.findAll();
    }

    @GetMapping("/{id}")
    public HeardPerson get(@PathVariable UUID id) {
        return repository.findById(id).orElseThrow(HeardPersonController::notFound);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<HeardPerson> create(@Valid @RequestBody CreateRequest request) {
        try {
            HeardPerson created = repository.create(request.reference(), request.minorityStatus());
            return ResponseEntity.created(URI.create("/api/heard-persons/" + created.id())).body(created);
        }
        catch (DuplicateKeyException failure) {
            throw referenceConflict();
        }
    }

    @PutMapping(path = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public HeardPerson update(@PathVariable UUID id, @Valid @RequestBody UpdateRequest request) {
        try {
            return repository.update(id, request.reference(), request.minorityStatus(), request.version())
                    .orElseGet(() -> {
                        if (repository.findById(id).isEmpty()) throw notFound();
                        throw new Conflict("concurrent_modification",
                                "The person was modified. Reload it before saving again.");
                    });
        }
        catch (DuplicateKeyException failure) {
            throw referenceConflict();
        }
    }

    private static Conflict referenceConflict() {
        return new Conflict("reference_conflict", "A person with this reference already exists.");
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Person not found.");
    }

    /** Machine-readable reason without a rejected reference or database exception. */
    static final class Conflict extends RuntimeException {
        private final String code;

        Conflict(String code, String detail) {
            super(detail);
            this.code = code;
        }

        String code() { return code; }
    }

    public record CreateRequest(
            @NotBlank @Size(max = 120) String reference,
            @NotNull MinorityStatus minorityStatus) {

        public CreateRequest {
            reference = reference == null ? null : reference.strip();
        }
    }

    public record UpdateRequest(
            @NotBlank @Size(max = 120) String reference,
            @NotNull MinorityStatus minorityStatus,
            @NotNull @PositiveOrZero Long version) {

        public UpdateRequest {
            reference = reference == null ? null : reference.strip();
        }
    }
}

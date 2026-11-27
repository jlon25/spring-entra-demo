package io.github.jlon25.springentrademo.hearingtype;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Profile("postgres")
@RequestMapping(path = "/api/hearing-types", produces = MediaType.APPLICATION_JSON_VALUE)
public class HearingTypeController {

    private final HearingTypeRepository repository;

    public HearingTypeController(HearingTypeRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public List<HearingType> list(@RequestParam(defaultValue = "true") boolean active) {
        return repository.findByActive(active);
    }

    @GetMapping("/{id}")
    public HearingType get(@PathVariable UUID id) {
        return repository.findById(id).orElseThrow(HearingTypeController::notFound);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<HearingType> create(@Valid @RequestBody CreateRequest request) {
        HearingType created = repository.create(request.label(), request.durationMinutes(),
                request.pauseMinutes(), request.defenderRequired());
        return ResponseEntity.created(URI.create("/api/hearing-types/" + created.id())).body(created);
    }

    @PutMapping(path = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public HearingType update(@PathVariable UUID id, @Valid @RequestBody UpdateRequest request) {
        return repository.update(id, request.label(), request.durationMinutes(), request.pauseMinutes(),
                request.defenderRequired(), request.version()).orElseGet(() -> {
                    if (repository.findById(id).isEmpty()) {
                        throw notFound();
                    }
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "The hearing type was modified. Reload it before saving again.");
                });
    }

    @PutMapping(path = "/{id}/status", consumes = MediaType.APPLICATION_JSON_VALUE)
    public HearingType setStatus(@PathVariable UUID id, @Valid @RequestBody StatusRequest request) {
        return repository.setActive(id, request.active(), request.version()).orElseGet(() -> {
            if (repository.findById(id).isEmpty()) throw notFound();
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The hearing type was modified. Reload it before changing its status.");
        });
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id,
            @RequestParam(required = false) Long version) {
        if (version == null || version < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A non-negative version is required.");
        }
        if (repository.delete(id, version) == 0) {
            if (repository.findById(id).isEmpty()) throw notFound();
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "The hearing type was modified. Reload it before deleting.");
        }
        return ResponseEntity.noContent().build();
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Hearing type not found.");
    }

    public record StatusRequest(@NotNull Boolean active, @NotNull @PositiveOrZero Long version) {
    }

    public record CreateRequest(
            @NotBlank @Size(max = 120) String label,
            @NotNull @Positive Integer durationMinutes,
            @NotNull @PositiveOrZero Integer pauseMinutes,
            @NotNull Boolean defenderRequired) {

        public CreateRequest {
            label = label == null ? null : label.strip();
        }
    }

    public record UpdateRequest(
            @NotBlank @Size(max = 120) String label,
            @NotNull @Positive Integer durationMinutes,
            @NotNull @PositiveOrZero Integer pauseMinutes,
            @NotNull Boolean defenderRequired,
            @NotNull @PositiveOrZero Long version) {

        public UpdateRequest {
            label = label == null ? null : label.strip();
        }
    }
}

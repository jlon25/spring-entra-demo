package io.github.jlon25.springentrademo.hearingtype;

import java.util.UUID;

public record HearingType(UUID id, String label, int durationMinutes, int pauseMinutes,
        boolean defenderRequired, long version) {
}

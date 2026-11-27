package io.github.jlon25.springentrademo.heardperson;

import java.util.UUID;

public record HeardPerson(UUID id, String reference, MinorityStatus minorityStatus, long version) {
}

package io.github.jlon25.springentrademo.heardperson;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import tools.jackson.databind.cfg.EnumFeature;

@Configuration(proxyBeanMethods = false)
@Profile("postgres")
class HeardPersonJsonConfiguration {

    @Bean
    JsonMapperBuilderCustomizer strictMinorityStatus() {
        // An ordinal is not an explicit minority-status value.
        return builder -> builder.enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS);
    }
}

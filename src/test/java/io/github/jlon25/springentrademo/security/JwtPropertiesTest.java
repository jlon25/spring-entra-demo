package io.github.jlon25.springentrademo.security;

import java.net.URI;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class JwtPropertiesTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(PropertiesOnly.class);

    @Test
    void contextFailsWhenJwtConfigurationIsMissing() {
        runner.run(context -> assertThat(context).hasFailed());
    }

    @Test
    void contextBindsExplicitJwtConfiguration() {
        runner.withPropertyValues("app.security.jwt.issuer=https://identity.example",
                        "app.security.jwt.jwk-set-uri=https://identity.example/jwks",
                        "app.security.jwt.audience=api")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(JwtProperties.class).audience()).isEqualTo("api");
                });
    }

    @Test
    void missingIssuerJwksOrAudienceIsRejected() {
        assertThatIllegalArgumentException().isThrownBy(
                () -> new JwtProperties(null, URI.create("https://identity.example/jwks"), "api"));
        assertThatIllegalArgumentException().isThrownBy(
                () -> new JwtProperties("https://identity.example", null, "api"));
        assertThatIllegalArgumentException().isThrownBy(
                () -> new JwtProperties("https://identity.example", URI.create("https://identity.example/jwks"), " "));
    }

    @Test
    void relativeOrUnsupportedTrustEndpointsAreRejected() {
        assertThatIllegalArgumentException().isThrownBy(
                () -> new JwtProperties("/relative", URI.create("https://identity.example/jwks"), "api"));
        assertThatIllegalArgumentException().isThrownBy(
                () -> new JwtProperties("https://identity.example", URI.create("file:///tmp/jwks.json"), "api"));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(JwtProperties.class)
    static class PropertiesOnly {
    }
}

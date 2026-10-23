package io.github.jlon25.springentrademo.security;

import java.net.URI;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.Assert;

@ConfigurationProperties("app.security.jwt")
public record JwtProperties(String issuer, URI jwkSetUri, String audience) {

    public JwtProperties {
        Assert.hasText(issuer, "JWT issuer must be configured");
        Assert.isTrue(isHttpUri(URI.create(issuer)), "JWT issuer must be an absolute HTTP(S) URI");
        Assert.isTrue(isHttpUri(jwkSetUri), "JWT JWK set URI must be an absolute HTTP(S) URI");
        Assert.hasText(audience, "JWT audience must be configured");
        Assert.isTrue(!audience.contains("${"), "JWT audience must be resolved");
    }

    private static boolean isHttpUri(URI uri) {
        return uri != null && uri.getHost() != null
                && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()));
    }
}

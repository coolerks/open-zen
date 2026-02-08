package com.aiagent.service;

import com.aiagent.dto.ProviderRequest;
import com.aiagent.dto.ProviderResponse;
import com.aiagent.entity.Provider;
import com.aiagent.mapper.ProviderMapper;
import com.aiagent.util.EncryptionUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class ProviderServiceTest {

    @Autowired
    private ProviderService providerService;

    @Autowired
    private ProviderMapper providerMapper;

    @Autowired
    private EncryptionUtil encryptionUtil;

    @BeforeEach
    void setUp() {
        // Clean up
        providerMapper.selectList(null).forEach(p -> providerMapper.deleteById(p.getId()));
    }

    @Test
    void testCreateProvider() {
        ProviderRequest req = new ProviderRequest();
        req.setName("OpenRouter");
        req.setBaseUrl("https://openrouter.ai/api/v1");
        req.setApiKey("sk-test-key-123");
        req.setEnabled(true);

        ProviderResponse resp = providerService.create(req);

        assertNotNull(resp.getId());
        assertEquals("OpenRouter", resp.getName());
        assertEquals("https://openrouter.ai/api/v1", resp.getBaseUrl());
        assertTrue(resp.getApiKeySet());
        assertTrue(resp.getEnabled());
    }

    @Test
    void testApiKeyEncryption() {
        ProviderRequest req = new ProviderRequest();
        req.setName("TestProvider");
        req.setBaseUrl("https://api.test.com");
        req.setApiKey("my-secret-api-key");

        ProviderResponse resp = providerService.create(req);

        // Verify API key is stored encrypted
        Provider raw = providerMapper.selectById(resp.getId());
        assertNotEquals("my-secret-api-key", raw.getApiKey());

        // Verify decryption works
        String decrypted = providerService.getDecryptedApiKey(resp.getId());
        assertEquals("my-secret-api-key", decrypted);
    }

    @Test
    void testApiKeyNotReturned() {
        ProviderRequest req = new ProviderRequest();
        req.setName("TestProvider");
        req.setBaseUrl("https://api.test.com");
        req.setApiKey("secret-key");

        ProviderResponse resp = providerService.create(req);

        // Response should only have apiKeySet flag, no actual key
        assertTrue(resp.getApiKeySet());
        // ProviderResponse has no apiKey field, only apiKeySet
    }

    @Test
    void testListProviders() {
        createTestProvider("Provider1");
        createTestProvider("Provider2");

        List<ProviderResponse> list = providerService.listAll();
        assertEquals(2, list.size());
    }

    @Test
    void testGetById() {
        ProviderResponse created = createTestProvider("TestGet");
        ProviderResponse fetched = providerService.getById(created.getId());
        assertEquals("TestGet", fetched.getName());
    }

    @Test
    void testGetByIdNotFound() {
        assertThrows(RuntimeException.class, () -> providerService.getById(99999L));
    }

    @Test
    void testUpdateProvider() {
        ProviderResponse created = createTestProvider("Original");

        ProviderRequest updateReq = new ProviderRequest();
        updateReq.setName("Updated");
        updateReq.setBaseUrl("https://updated.api.com");
        updateReq.setEnabled(false);
        // apiKey is null -> should keep existing

        ProviderResponse updated = providerService.update(created.getId(), updateReq);
        assertEquals("Updated", updated.getName());
        assertEquals("https://updated.api.com", updated.getBaseUrl());
        assertFalse(updated.getEnabled());
        assertTrue(updated.getApiKeySet()); // Key should still be set
    }

    @Test
    void testUpdateProviderWithNewApiKey() {
        ProviderResponse created = createTestProvider("WithKey");

        ProviderRequest updateReq = new ProviderRequest();
        updateReq.setName("WithKey");
        updateReq.setBaseUrl("https://api.test.com");
        updateReq.setApiKey("new-secret-key");
        updateReq.setEnabled(true);

        providerService.update(created.getId(), updateReq);

        String decrypted = providerService.getDecryptedApiKey(created.getId());
        assertEquals("new-secret-key", decrypted);
    }

    @Test
    void testToggleEnabled() {
        ProviderResponse created = createTestProvider("Toggle");
        assertTrue(created.getEnabled());

        providerService.toggleEnabled(created.getId(), false);
        ProviderResponse updated = providerService.getById(created.getId());
        assertFalse(updated.getEnabled());

        providerService.toggleEnabled(created.getId(), true);
        updated = providerService.getById(created.getId());
        assertTrue(updated.getEnabled());
    }

    private ProviderResponse createTestProvider(String name) {
        ProviderRequest req = new ProviderRequest();
        req.setName(name);
        req.setBaseUrl("https://api.test.com");
        req.setApiKey("test-key");
        req.setEnabled(true);
        return providerService.create(req);
    }
}

package com.aiagent;

import com.aiagent.service.TerminalService;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;

@SpringBootApplication
@MapperScan("com.aiagent.mapper")
public class AiAgentApplication {
    public static void main(String[] args) {
        ConfigurableApplicationContext context = SpringApplication.run(AiAgentApplication.class, args);

        // Register shutdown hook to clean up terminal sessions
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            TerminalService terminalService = context.getBean(TerminalService.class);
            terminalService.closeAllSessions();
        }));
    }
}

package com.aiagent.service;

import com.aiagent.dto.ProjectFsWatchEventResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.ClosedWatchServiceException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

import static java.nio.file.StandardWatchEventKinds.ENTRY_CREATE;
import static java.nio.file.StandardWatchEventKinds.ENTRY_DELETE;
import static java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY;
import static java.nio.file.StandardWatchEventKinds.OVERFLOW;

@Service
@Slf4j
public class ProjectFilesystemWatchService {

    private static final long WATCH_DEBOUNCE_MS = 160L;
    private static final long SELF_WRITE_SUPPRESS_MS = 1800L;
    private static final String INTERNAL_TEMP_FILE_PREFIX = ".openzen-write-";

    private final ConcurrentMap<String, WatchContext> contextMap = new ConcurrentHashMap<>();

    public SseEmitter subscribe(String projectId, Path rootPath, String clientId) {
        String normalizedClientId = normalizeClientId(clientId);
        WatchContext context = getOrCreateContext(projectId, rootPath);
        return context.subscribe(normalizedClientId);
    }

    public void updateInterests(String projectId,
                                Path rootPath,
                                String clientId,
                                List<String> openFiles,
                                List<String> expandedDirs) {
        String normalizedClientId = normalizeClientId(clientId);
        WatchContext context = getOrCreateContext(projectId, rootPath);
        context.updateInterests(normalizedClientId, normalizePaths(openFiles), normalizePaths(expandedDirs));
    }

    public void markSelfWrite(String projectId,
                              Path rootPath,
                              String relativePath,
                              String clientId) {
        if (clientId == null || clientId.trim().isEmpty()) {
            return;
        }
        String normalizedClientId = normalizeClientId(clientId);
        String normalizedPath = normalizeRelativePath(relativePath);
        if (normalizedPath.isEmpty()) {
            return;
        }
        WatchContext context = getOrCreateContext(projectId, rootPath);
        context.markSelfWrite(normalizedClientId, normalizedPath);
    }

    @PreDestroy
    public void shutdownAll() {
        contextMap.values().forEach(WatchContext::close);
        contextMap.clear();
    }

    private WatchContext getOrCreateContext(String projectId, Path rootPath) {
        return contextMap.compute(projectId, (key, oldContext) -> {
            if (oldContext != null) {
                if (oldContext.isSameRoot(rootPath)) {
                    return oldContext;
                }
                oldContext.close();
            }
            return new WatchContext(projectId, rootPath, () -> contextMap.remove(projectId));
        });
    }

    private String normalizeClientId(String clientId) {
        if (clientId == null) {
            throw new RuntimeException("clientId 不能为空");
        }
        String normalized = clientId.trim();
        if (normalized.isEmpty()) {
            throw new RuntimeException("clientId 不能为空");
        }
        return normalized;
    }

    private Set<String> normalizePaths(List<String> paths) {
        if (paths == null || paths.isEmpty()) {
            return Collections.emptySet();
        }
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String path : paths) {
            String normalizedPath = normalizeRelativePath(path);
            normalized.add(normalizedPath);
        }
        return normalized;
    }

    private String normalizeRelativePath(String rawPath) {
        if (rawPath == null) {
            return "";
        }
        String normalized = rawPath.trim().replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/") && !normalized.isEmpty()) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.isEmpty()) {
            return "";
        }
        try {
            Path candidate = Paths.get(normalized).normalize();
            if (candidate.isAbsolute()) {
                return "";
            }
            String candidateText = candidate.toString().replace('\\', '/');
            if (candidateText.startsWith("..")) {
                return "";
            }
            return candidateText;
        } catch (InvalidPathException ex) {
            return "";
        }
    }

    private static final class WatchSubscriber {

        private final String clientId;
        private final SseEmitter emitter;

        private volatile Set<String> openFiles = Collections.emptySet();
        private volatile Set<String> expandedDirs = Collections.emptySet();

        private WatchSubscriber(String clientId, SseEmitter emitter) {
            this.clientId = clientId;
            this.emitter = emitter;
        }

        private void updateInterests(Set<String> nextOpenFiles, Set<String> nextExpandedDirs) {
            this.openFiles = nextOpenFiles;
            this.expandedDirs = nextExpandedDirs;
        }
    }

    private static final class PendingEventState {

        private boolean created;
        private boolean modified;
        private boolean deleted;
        private boolean directory;

        private void merge(String kind, boolean directory) {
            if ("create".equals(kind)) {
                this.created = true;
            } else if ("delete".equals(kind)) {
                this.deleted = true;
            } else {
                this.modified = true;
            }
            this.directory = this.directory || directory;
        }

        private String resolveKind() {
            if (deleted && !created) {
                return "delete";
            }
            if (created && !deleted) {
                return "create";
            }
            return "modify";
        }
    }

    private final class WatchContext {

        private final String projectId;
        private final Path rootPath;
        private final Runnable emptyCallback;
        private final WatchService watchService;

        private final ConcurrentMap<String, WatchSubscriber> subscribers = new ConcurrentHashMap<>();
        private final ConcurrentMap<Path, WatchKey> watchedDirectoryKeys = new ConcurrentHashMap<>();
        private final ConcurrentMap<WatchKey, Path> watchedKeyDirectories = new ConcurrentHashMap<>();
        private final ConcurrentMap<String, PendingEventState> pendingEvents = new ConcurrentHashMap<>();
        private final ConcurrentMap<String, ConcurrentMap<String, Long>> selfWriteDeadlineMap = new ConcurrentHashMap<>();

        private final ScheduledExecutorService workerExecutor;
        private final ScheduledExecutorService debounceExecutor;

        private volatile boolean closed = false;
        private volatile ScheduledFuture<?> pendingFlushTask;

        private WatchContext(String projectId, Path rootPath, Runnable emptyCallback) {
            this.projectId = projectId;
            this.rootPath = rootPath.toAbsolutePath().normalize();
            this.emptyCallback = emptyCallback;
            try {
                this.watchService = this.rootPath.getFileSystem().newWatchService();
            } catch (IOException ex) {
                throw new RuntimeException("初始化文件监听失败，请稍后重试。");
            }
            this.workerExecutor = Executors.newSingleThreadScheduledExecutor(new NamedThreadFactory("project-watch-" + projectId));
            this.debounceExecutor = Executors.newSingleThreadScheduledExecutor(new NamedThreadFactory("project-watch-debounce-" + projectId));
            this.workerExecutor.execute(this::watchLoop);
            refreshWatchDirectories();
        }

        private boolean isSameRoot(Path path) {
            return this.rootPath.equals(path.toAbsolutePath().normalize());
        }

        private SseEmitter subscribe(String clientId) {
            ensureNotClosed();
            SseEmitter emitter = new SseEmitter(0L);
            WatchSubscriber subscriber = new WatchSubscriber(clientId, emitter);
            WatchSubscriber oldSubscriber = subscribers.put(clientId, subscriber);
            if (oldSubscriber != null) {
                oldSubscriber.emitter.complete();
            }

            emitter.onCompletion(() -> removeSubscriber(clientId));
            emitter.onTimeout(() -> removeSubscriber(clientId));
            emitter.onError((error) -> removeSubscriber(clientId));

            try {
                emitter.send(SseEmitter.event().name("connected").data("ok"));
            } catch (IOException ex) {
                removeSubscriber(clientId);
                throw new RuntimeException("文件监听连接建立失败，请重试。");
            }

            refreshWatchDirectories();
            return emitter;
        }

        private void updateInterests(String clientId, Set<String> openFiles, Set<String> expandedDirs) {
            WatchSubscriber subscriber = subscribers.get(clientId);
            if (subscriber == null) {
                throw new RuntimeException("文件监听连接已失效，请刷新页面后重试。");
            }
            Set<String> normalizedOpenFiles = normalizeFilesForWatch(openFiles);
            Set<String> normalizedExpandedDirs = normalizeDirectoriesForWatch(expandedDirs);
            normalizedExpandedDirs.add("");
            subscriber.updateInterests(normalizedOpenFiles, normalizedExpandedDirs);
            refreshWatchDirectories();
        }

        private Set<String> normalizeFilesForWatch(Set<String> openFiles) {
            if (openFiles == null || openFiles.isEmpty()) {
                return Collections.emptySet();
            }
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (String path : openFiles) {
                String relativePath = normalizeRelativePath(path);
                if (relativePath.isEmpty()) {
                    continue;
                }
                Path absolutePath = resolvePathInsideRoot(relativePath);
                if (absolutePath == null || !Files.exists(absolutePath) || Files.isDirectory(absolutePath)) {
                    continue;
                }
                normalized.add(relativePath);
            }
            return normalized;
        }

        private Set<String> normalizeDirectoriesForWatch(Set<String> expandedDirs) {
            if (expandedDirs == null || expandedDirs.isEmpty()) {
                return new LinkedHashSet<>();
            }
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (String path : expandedDirs) {
                String relativePath = normalizeRelativePath(path);
                if (relativePath.isEmpty()) {
                    normalized.add("");
                    continue;
                }
                Path absolutePath = resolvePathInsideRoot(relativePath);
                if (absolutePath == null || !Files.exists(absolutePath) || !Files.isDirectory(absolutePath)) {
                    continue;
                }
                normalized.add(relativePath);
            }
            return normalized;
        }

        private synchronized void refreshWatchDirectories() {
            if (closed) {
                return;
            }
            Set<Path> requiredDirectories = new LinkedHashSet<>();
            requiredDirectories.add(rootPath);

            for (WatchSubscriber subscriber : subscribers.values()) {
                for (String expandedDir : subscriber.expandedDirs) {
                    Path expandedPath = expandedDir.isEmpty() ? rootPath : resolvePathInsideRoot(expandedDir);
                    if (expandedPath != null && Files.exists(expandedPath) && Files.isDirectory(expandedPath)) {
                        requiredDirectories.add(expandedPath);
                    }
                }
                for (String openFile : subscriber.openFiles) {
                    Path filePath = resolvePathInsideRoot(openFile);
                    if (filePath == null) {
                        continue;
                    }
                    Path parent = filePath.getParent();
                    if (parent == null) {
                        requiredDirectories.add(rootPath);
                        continue;
                    }
                    if (Files.exists(parent) && Files.isDirectory(parent)) {
                        requiredDirectories.add(parent);
                    }
                }
            }

            for (Path directory : requiredDirectories) {
                if (watchedDirectoryKeys.containsKey(directory)) {
                    continue;
                }
                registerWatchDirectory(directory);
            }

            for (Path directory : new ArrayList<>(watchedDirectoryKeys.keySet())) {
                if (requiredDirectories.contains(directory)) {
                    continue;
                }
                unregisterWatchDirectory(directory);
            }
        }

        private void registerWatchDirectory(Path directory) {
            if (!Files.exists(directory) || !Files.isDirectory(directory)) {
                return;
            }
            try {
                WatchKey key = directory.register(watchService, ENTRY_CREATE, ENTRY_DELETE, ENTRY_MODIFY);
                watchedDirectoryKeys.put(directory, key);
                watchedKeyDirectories.put(key, directory);
            } catch (IOException ex) {
                log.warn("Project watch register failed, projectId={}, path={}, error={}",
                        projectId,
                        directory,
                        ex.getMessage());
            }
        }

        private void unregisterWatchDirectory(Path directory) {
            WatchKey key = watchedDirectoryKeys.remove(directory);
            if (key == null) {
                return;
            }
            watchedKeyDirectories.remove(key);
            key.cancel();
        }

        private void watchLoop() {
            while (!closed) {
                WatchKey key;
                try {
                    key = watchService.take();
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (ClosedWatchServiceException ex) {
                    break;
                }

                Path watchDirectory = watchedKeyDirectories.get(key);
                if (watchDirectory == null) {
                    key.reset();
                    continue;
                }

                List<WatchEvent<?>> events = key.pollEvents();
                for (WatchEvent<?> event : events) {
                    handleRawWatchEvent(watchDirectory, event);
                }

                boolean valid = key.reset();
                if (!valid) {
                    Path removedDirectory = watchedKeyDirectories.remove(key);
                    if (removedDirectory != null) {
                        watchedDirectoryKeys.remove(removedDirectory);
                    }
                    refreshWatchDirectories();
                }
            }
        }

        private void handleRawWatchEvent(Path watchDirectory, WatchEvent<?> event) {
            WatchEvent.Kind<?> kind = event.kind();
            if (kind == OVERFLOW) {
                enqueueWatchEvent("", "overflow", true);
                return;
            }
            Object context = event.context();
            if (!(context instanceof Path changedName)) {
                return;
            }
            Path changedAbsolutePath = watchDirectory.resolve(changedName).normalize();
            if (!changedAbsolutePath.startsWith(rootPath)) {
                return;
            }
            String relativePath = toRelativePath(changedAbsolutePath);
            if (relativePath.isEmpty()) {
                return;
            }
            String baseName = changedAbsolutePath.getFileName() == null
                    ? relativePath
                    : changedAbsolutePath.getFileName().toString();
            if (baseName.startsWith(INTERNAL_TEMP_FILE_PREFIX)) {
                return;
            }

            String normalizedKind = normalizeKind(kind);
            boolean directory = Files.isDirectory(changedAbsolutePath);

            if (kind == ENTRY_DELETE) {
                unregisterWatchDirectory(changedAbsolutePath);
            }

            if (kind == ENTRY_CREATE && directory) {
                // 新目录创建后，重新按兴趣集合注册，确保新增目录被懒加载监听覆盖。
                refreshWatchDirectories();
            }

            enqueueWatchEvent(relativePath, normalizedKind, directory);
        }

        private String normalizeKind(WatchEvent.Kind<?> kind) {
            if (kind == ENTRY_CREATE) {
                return "create";
            }
            if (kind == ENTRY_DELETE) {
                return "delete";
            }
            return "modify";
        }

        private void enqueueWatchEvent(String relativePath, String kind, boolean directory) {
            pendingEvents.compute(relativePath, (key, oldState) -> {
                PendingEventState state = oldState == null ? new PendingEventState() : oldState;
                state.merge(kind, directory);
                return state;
            });
            scheduleFlush();
        }

        private synchronized void scheduleFlush() {
            if (closed) {
                return;
            }
            if (pendingFlushTask != null && !pendingFlushTask.isDone()) {
                return;
            }
            pendingFlushTask = debounceExecutor.schedule(this::flushPendingEventsSafely, WATCH_DEBOUNCE_MS, TimeUnit.MILLISECONDS);
        }

        private void flushPendingEventsSafely() {
            try {
                flushPendingEvents();
            } catch (Exception ex) {
                log.warn("Project watch flush failed, projectId={}, error={}", projectId, ex.getMessage());
            }
        }

        private void flushPendingEvents() {
            if (closed || pendingEvents.isEmpty()) {
                return;
            }

            Map<String, PendingEventState> snapshot = new ConcurrentHashMap<>(pendingEvents);
            snapshot.keySet().forEach(pendingEvents::remove);
            if (snapshot.isEmpty()) {
                return;
            }

            long now = System.currentTimeMillis();
            List<ProjectFsWatchEventResponse> events = snapshot.entrySet().stream()
                    .map(entry -> toWatchResponse(entry.getKey(), entry.getValue(), now))
                    .toList();

            if (events.isEmpty()) {
                return;
            }

            List<String> disconnectedClientIds = new ArrayList<>();

            for (WatchSubscriber subscriber : subscribers.values()) {
                for (ProjectFsWatchEventResponse event : events) {
                    if (!shouldDispatchToSubscriber(subscriber, event)) {
                        continue;
                    }
                    if (!"overflow".equals(event.getKind()) && isSelfSuppressed(event.getPath(), subscriber.clientId, now)) {
                        continue;
                    }
                    try {
                        subscriber.emitter.send(SseEmitter.event().name("change").data(event));
                    } catch (IOException ex) {
                        disconnectedClientIds.add(subscriber.clientId);
                        break;
                    }
                }
            }

            if (!disconnectedClientIds.isEmpty()) {
                disconnectedClientIds.forEach(this::removeSubscriber);
            }
        }

        private ProjectFsWatchEventResponse toWatchResponse(String path, PendingEventState state, long now) {
            ProjectFsWatchEventResponse response = new ProjectFsWatchEventResponse();
            String kind = state.resolveKind();
            response.setKind(path.isEmpty() ? "overflow" : kind);
            response.setPath(path);
            response.setDirectoryPath(parentRelativePath(path));
            response.setDirectory(state.directory);
            response.setTimestamp(now);
            return response;
        }

        private boolean shouldDispatchToSubscriber(WatchSubscriber subscriber, ProjectFsWatchEventResponse event) {
            if ("overflow".equals(event.getKind())) {
                return true;
            }

            String changedPath = event.getPath();
            if (subscriber.openFiles.contains(changedPath)) {
                return true;
            }
            if (subscriber.expandedDirs.contains(event.getDirectoryPath())) {
                return true;
            }
            return event.isDirectory() && subscriber.expandedDirs.contains(changedPath);
        }

        private boolean isSelfSuppressed(String path, String clientId, long now) {
            ConcurrentMap<String, Long> clientDeadlines = selfWriteDeadlineMap.get(path);
            if (clientDeadlines == null) {
                return false;
            }
            Long deadline = clientDeadlines.get(clientId);
            if (deadline == null) {
                cleanupExpiredSelfMarks(clientDeadlines, now);
                return false;
            }
            if (deadline >= now) {
                return true;
            }
            clientDeadlines.remove(clientId);
            cleanupExpiredSelfMarks(clientDeadlines, now);
            if (clientDeadlines.isEmpty()) {
                selfWriteDeadlineMap.remove(path, clientDeadlines);
            }
            return false;
        }

        private void cleanupExpiredSelfMarks(ConcurrentMap<String, Long> clientDeadlines, long now) {
            for (Map.Entry<String, Long> entry : clientDeadlines.entrySet()) {
                if (entry.getValue() < now) {
                    clientDeadlines.remove(entry.getKey(), entry.getValue());
                }
            }
        }

        private void markSelfWrite(String clientId, String relativePath) {
            long deadline = System.currentTimeMillis() + SELF_WRITE_SUPPRESS_MS;
            selfWriteDeadlineMap
                    .computeIfAbsent(relativePath, key -> new ConcurrentHashMap<>())
                    .put(clientId, deadline);
        }

        private String parentRelativePath(String relativePath) {
            if (relativePath == null || relativePath.isEmpty()) {
                return "";
            }
            int index = relativePath.lastIndexOf('/');
            if (index < 0) {
                return "";
            }
            return relativePath.substring(0, index);
        }

        private Path resolvePathInsideRoot(String relativePath) {
            String normalized = normalizeRelativePath(relativePath);
            if (normalized.isEmpty()) {
                return rootPath;
            }
            try {
                Path resolved = rootPath.resolve(normalized).normalize();
                if (!resolved.startsWith(rootPath)) {
                    return null;
                }
                return resolved;
            } catch (InvalidPathException ex) {
                return null;
            }
        }

        private String toRelativePath(Path path) {
            if (path.equals(rootPath)) {
                return "";
            }
            return rootPath.relativize(path).toString().replace('\\', '/');
        }

        private synchronized void removeSubscriber(String clientId) {
            WatchSubscriber removed = subscribers.remove(clientId);
            if (removed == null) {
                return;
            }
            removed.emitter.complete();
            if (subscribers.isEmpty()) {
                close();
                emptyCallback.run();
                return;
            }
            refreshWatchDirectories();
        }

        private synchronized void close() {
            if (closed) {
                return;
            }
            closed = true;

            subscribers.values().forEach(subscriber -> {
                try {
                    subscriber.emitter.complete();
                } catch (Exception ignored) {
                    // 关闭阶段忽略。
                }
            });
            subscribers.clear();

            if (pendingFlushTask != null) {
                pendingFlushTask.cancel(false);
            }

            watchedDirectoryKeys.values().forEach(WatchKey::cancel);
            watchedDirectoryKeys.clear();
            watchedKeyDirectories.clear();
            pendingEvents.clear();
            selfWriteDeadlineMap.clear();

            try {
                watchService.close();
            } catch (IOException ignored) {
                // 关闭阶段忽略。
            }

            workerExecutor.shutdownNow();
            debounceExecutor.shutdownNow();
        }

        private void ensureNotClosed() {
            if (closed) {
                throw new RuntimeException("文件监听连接已关闭，请稍后重试。");
            }
        }
    }

    private static final class NamedThreadFactory implements ThreadFactory {

        private final String name;

        private NamedThreadFactory(String name) {
            this.name = name;
        }

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        }
    }
}

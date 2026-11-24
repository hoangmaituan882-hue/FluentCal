<script setup lang="ts">
import { computed, ref } from 'vue';
import { FIcon } from '@/fluent';
import {
  conflictItemKindLabel,
  summarizeConflictSide,
  type ConflictResolutionChoice,
  type SyncConflict,
} from '@/lib/syncConflicts';
import {
  conflictStore,
  dismissSyncConflict,
  resolveAllSyncConflicts,
  resolveSyncConflict,
} from '@/composables/syncConflicts';

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const bulkBusy = ref(false);
const notice = ref('');
const conflicts = computed(() => conflictStore.items);

function fmtStamp(ts: number): string {
  if (!ts) return '未知时间';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '未知时间';
  }
}

function canKeepBoth(c: SyncConflict): boolean {
  return c.collection === 'tasks' && c.localValue !== null && c.remoteValue !== null;
}

async function handleResolve(c: SyncConflict, choice: ConflictResolutionChoice) {
  notice.value = '';
  try {
    await resolveSyncConflict(c, choice);
    notice.value =
      choice === 'local'
        ? `已为「${c.title}」保留本机版本并同步`
        : choice === 'remote'
          ? `已为「${c.title}」采用云端版本并同步`
          : `已为「${c.title}」保留两份副本并同步`;
  } catch (e) {
    notice.value = `处理冲突失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

async function handleBulk(choice: 'local' | 'remote') {
  if (bulkBusy.value || !conflicts.value.length) return;
  bulkBusy.value = true;
  notice.value = '';
  try {
    const n = conflicts.value.length;
    await resolveAllSyncConflicts(choice);
    notice.value =
      choice === 'local'
        ? `已将 ${n} 处冲突全部保留本机版本`
        : `已将 ${n} 处冲突全部采用云端版本`;
  } catch (e) {
    notice.value = `批量处理失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    bulkBusy.value = false;
  }
}
</script>

<template>
  <section class="sc-panel" :class="{ compact, hasConflicts: conflicts.length > 0 }" aria-label="多端同步冲突检测与处理">
    <!-- Clean Zero-Conflict Verification State -->
    <div v-if="conflicts.length === 0" class="sc-clean-card">
      <div class="sc-clean-ico" aria-hidden="true">
        <FIcon name="completed" :size="16" />
      </div>
      <div class="sc-clean-body">
        <div class="sc-clean-title">暂无同步冲突 · 多端数据一致</div>
        <p class="sc-clean-sub">
          当同一日程、习惯或分组在多台设备离线同时修改时，系统会自动留存双端快照并在此展示可视化对比，不会悄悄覆盖你的内容。
        </p>
      </div>
      <span class="sc-clean-pill">已保护</span>
    </div>

    <!-- Active Conflicts Visual Resolver -->
    <template v-else>
      <header class="sc-alert-head">
        <div class="sc-alert-left">
          <span class="sc-warn-dot" aria-hidden="true">
            <FIcon name="warning" :size="14" />
          </span>
          <div>
            <div class="sc-alert-title">
              检测到 {{ conflicts.length }} 处多端同步冲突
            </div>
            <p class="sc-alert-sub">
              同一条目在多台设备上同时产生修改，系统暂按较新版本展示，请逐条确认最终保留哪一版。
            </p>
          </div>
        </div>

        <div class="sc-bulk-acts">
          <button
            type="button"
            class="sc-btn ghost"
            :disabled="bulkBusy || !!conflictStore.resolvingId"
            @click="handleBulk('local')"
          >
            全部保留本机
          </button>
          <button
            type="button"
            class="sc-btn ghost"
            :disabled="bulkBusy || !!conflictStore.resolvingId"
            @click="handleBulk('remote')"
          >
            全部采用云端
          </button>
        </div>
      </header>

      <TransitionGroup name="sc-list" tag="div" class="sc-list">
        <article
          v-for="c in conflicts"
          :key="c.id"
          class="sc-item"
          :class="{ busy: conflictStore.resolvingId === c.id }"
        >
          <div class="sc-item-head">
            <div class="sc-item-title-row">
              <span class="sc-kind-tag" :data-kind="c.itemKind">{{ conflictItemKindLabel(c.itemKind) }}</span>
              <h4 class="sc-item-title">{{ c.title }}</h4>
            </div>
            <div class="sc-field-chips">
              <span v-for="f in c.changedFields" :key="f" class="sc-chip">{{ f }}</span>
            </div>
          </div>

          <div class="sc-diff-grid">
            <!-- Local Side -->
            <div class="sc-side local" :class="{ winner: c.autoWinner === 'local', deleted: c.localValue === null }">
              <div class="sc-side-top">
                <span class="sc-side-label">
                  <FIcon name="desktop" :size="11" />
                  <span>本机版本</span>
                  <em v-if="c.localDevice && c.localDevice !== '本机'" class="sc-dev">· {{ c.localDevice }}</em>
                </span>
                <span v-if="c.autoWinner === 'local'" class="sc-winner-tag">当前显示</span>
              </div>
              <p class="sc-side-summary">{{ summarizeConflictSide(c.collection, c.localValue) }}</p>
              <div class="sc-side-time">修改于 {{ fmtStamp(c.localUpdatedAt) }}</div>
            </div>

            <!-- Remote Side -->
            <div class="sc-side remote" :class="{ winner: c.autoWinner === 'remote', deleted: c.remoteValue === null }">
              <div class="sc-side-top">
                <span class="sc-side-label">
                  <FIcon name="cloud" :size="11" />
                  <span>云端版本</span>
                  <em v-if="c.remoteDevice" class="sc-dev">· {{ c.remoteDevice }}</em>
                </span>
                <span v-if="c.autoWinner === 'remote'" class="sc-winner-tag">当前显示</span>
              </div>
              <p class="sc-side-summary">{{ summarizeConflictSide(c.collection, c.remoteValue) }}</p>
              <div class="sc-side-time">修改于 {{ fmtStamp(c.remoteUpdatedAt) }}</div>
            </div>
          </div>

          <footer class="sc-item-acts">
            <button
              type="button"
              class="sc-btn primary"
              :disabled="bulkBusy || conflictStore.resolvingId === c.id"
              @click="handleResolve(c, 'local')"
            >
              <FIcon name="checkMark" :size="11" />
              <span>保留本机</span>
            </button>
            <button
              type="button"
              class="sc-btn"
              :disabled="bulkBusy || conflictStore.resolvingId === c.id"
              @click="handleResolve(c, 'remote')"
            >
              <FIcon name="cloud" :size="11" />
              <span>采用云端</span>
            </button>
            <button
              v-if="canKeepBoth(c)"
              type="button"
              class="sc-btn"
              :disabled="bulkBusy || conflictStore.resolvingId === c.id"
              @click="handleResolve(c, 'both')"
            >
              <FIcon name="copy" :size="11" />
              <span>保留两份</span>
            </button>
            <button
              type="button"
              class="sc-btn subtle sc-dismiss"
              title="维持当前版本并忽略此条冲突提醒"
              :disabled="bulkBusy || conflictStore.resolvingId === c.id"
              @click="dismissSyncConflict(c.id)"
            >
              忽略
            </button>
          </footer>
        </article>
      </TransitionGroup>
    </template>

    <p v-if="notice" class="sc-notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.sc-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sc-clean-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 15px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, #10a37f 26%, var(--card-stroke, rgba(0, 0, 0, 0.08)));
  background: color-mix(in srgb, #10a37f 6%, var(--card-fill, #ffffff));
}

.sc-clean-ico {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, #10a37f 14%, transparent);
  color: #0d8c6d;
}

:global(html[data-ws-theme='dark']) .sc-clean-ico {
  color: #34d399;
}

.sc-clean-body {
  flex: 1;
  min-width: 0;
}

.sc-clean-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, var(--ws-ink));
}

.sc-clean-sub {
  margin: 3px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.sc-clean-pill {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  color: #0d8c6d;
  background: color-mix(in srgb, #10a37f 14%, transparent);
}

:global(html[data-ws-theme='dark']) .sc-clean-pill {
  color: #34d399;
}

.sc-alert-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 13px 15px;
  border-radius: 14px;
  border: 1px solid rgba(245, 158, 11, 0.38);
  background: color-mix(in srgb, #f59e0b 8%, var(--card-fill, #ffffff));
}

.sc-alert-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 220px;
}

.sc-warn-dot {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: rgba(245, 158, 11, 0.16);
  color: #d97706;
}

:global(html[data-ws-theme='dark']) .sc-warn-dot {
  color: #fbbf24;
}

.sc-alert-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-primary, var(--ws-ink));
}

.sc-alert-sub {
  margin: 3px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.sc-bulk-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sc-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sc-item {
  border-radius: 14px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.09));
  background: var(--card-fill, #ffffff);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sc-item.busy {
  opacity: 0.6;
  pointer-events: none;
}

.sc-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.sc-item-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sc-kind-tag {
  flex: none;
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-fill, #10a37f) 12%, transparent);
  color: var(--accent-text, #0d8c6d);
}

.sc-kind-tag[data-kind='habit'] {
  background: rgba(16, 163, 127, 0.14);
  color: #0d8c6d;
}

.sc-kind-tag[data-kind='subscription'] {
  background: rgba(139, 92, 246, 0.14);
  color: #7c3aed;
}

.sc-kind-tag[data-kind='countdown'] {
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}

:global(html[data-ws-theme='dark']) .sc-kind-tag[data-kind='habit'] {
  color: #34d399;
}

:global(html[data-ws-theme='dark']) .sc-kind-tag[data-kind='subscription'] {
  color: #c4b5fd;
}

:global(html[data-ws-theme='dark']) .sc-kind-tag[data-kind='countdown'] {
  color: #fbbf24;
}

.sc-item-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--text-primary, var(--ws-ink));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-field-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sc-chip {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.13);
  color: #b45309;
  font-weight: 500;
}

:global(html[data-ws-theme='dark']) .sc-chip {
  color: #fcd34d;
  background: rgba(245, 158, 11, 0.18);
}

.sc-diff-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.sc-panel.compact .sc-diff-grid {
  grid-template-columns: 1fr;
}

@media (max-width: 640px) {
  .sc-diff-grid {
    grid-template-columns: 1fr;
  }
}

.sc-side {
  border-radius: 11px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.08));
  background: color-mix(in srgb, var(--subtle-fill-hover, rgba(0, 0, 0, 0.03)) 65%, transparent);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sc-side.winner {
  border-color: color-mix(in srgb, #10a37f 40%, var(--card-stroke, rgba(0, 0, 0, 0.08)));
}

.sc-side.deleted {
  border-style: dashed;
  border-color: rgba(239, 68, 68, 0.36);
}

.sc-side-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.sc-side-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.sc-dev {
  font-style: normal;
  font-weight: 400;
  opacity: 0.85;
}

.sc-winner-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(16, 163, 127, 0.14);
  color: #0d8c6d;
}

:global(html[data-ws-theme='dark']) .sc-winner-tag {
  color: #34d399;
}

.sc-side-summary {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-primary, var(--ws-ink));
  word-break: break-word;
}

.sc-side-time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary, var(--ws-ink-muted));
}

.sc-item-acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding-top: 2px;
}

.sc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 8px;
  border: 1px solid var(--card-stroke, rgba(0, 0, 0, 0.12));
  background: var(--solid-base, rgba(255, 255, 255, 0.8));
  color: var(--text-primary, var(--ws-ink));
  padding: 6px 11px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, transform 120ms ease;
}

.sc-btn:hover:not(:disabled) {
  background: var(--subtle-fill-hover, rgba(0, 0, 0, 0.06));
}

.sc-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.sc-btn.primary {
  background: #10a37f;
  border-color: transparent;
  color: #ffffff;
}

.sc-btn.primary:hover:not(:disabled) {
  background: #0d8c6d;
}

.sc-btn.ghost {
  background: transparent;
  border-color: rgba(217, 119, 6, 0.35);
  color: #b45309;
}

:global(html[data-ws-theme='dark']) .sc-btn.ghost {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.35);
}

.sc-btn.subtle {
  border-color: transparent;
  background: transparent;
  color: var(--text-secondary, var(--ws-ink-secondary));
}

.sc-dismiss {
  margin-left: auto;
}

.sc-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.sc-notice {
  margin: 0;
  font-size: 12px;
  color: #0d8c6d;
}

:global(html[data-ws-theme='dark']) .sc-notice {
  color: #34d399;
}

.sc-list-leave-active {
  transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sc-list-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
</style>

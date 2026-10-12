<script setup>
import { onMounted } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'

const { settings, state, checkConnection } = useMergeSession()
onMounted(checkConnection)
</script>

<template>
  <section>
    <h2>Connect to Anki</h2>
    <p class="muted">Anki must be open with both add-ons installed. Every merge writes a full collection backup first.</p>

    <div class="grid2">
      <div class="card">
        <h3>AnkiConnect</h3>
        <label>URL <input v-model.trim="settings.ankiConnectUrl" /></label>
        <p v-if="state.connection.anki" :class="state.connection.anki.ok ? 'ok-text' : 'warn-text'">
          {{ state.connection.anki.ok ? '✓' : '✗' }} {{ state.connection.anki.detail }}
        </p>
        <p class="muted small">Reads and writes notes. Install from AnkiWeb with code <code>2055492159</code>.</p>
      </div>
      <div class="card">
        <h3>anki-ai-bridge</h3>
        <label>URL <input v-model.trim="settings.bridgeUrl" /></label>
        <p v-if="state.connection.bridge" :class="state.connection.bridge.ok ? 'ok-text' : 'warn-text'">
          {{ state.connection.bridge.ok ? '✓' : '✗' }} {{ state.connection.bridge.detail }}
        </p>
        <p class="muted small">
          Creates the pre-merge backup (<code>POST /backup</code>) and matches notes by GUID. Needs a bridge version that has
          both routes — restart Anki after updating it.
        </p>
      </div>
    </div>

    <button class="primary" :disabled="state.connection.checking" @click="checkConnection">
      {{ state.connection.checking ? 'Checking…' : 'Check connection' }}
    </button>
  </section>
</template>

<script lang="ts">
  export let sender: 'user' | 'ai';
  export let text: string;
</script>

<div class="bubble {sender === 'user' ? 'user' : 'ai'}">
  <div class="sender">{sender === 'user' ? 'You' : 'Agent'}</div>
  <div class="text">{text}</div>
</div>

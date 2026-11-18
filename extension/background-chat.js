'use strict';
importScripts('background.js', 'postgame-review.js', 'chat/delivery.js', 'chat/integrations.js');

const chatIntegrations = chrome.alarms && MJChatIntegrations.create({ storage: chrome.storage.local,
  storageReady: trustedStorage, discussions, deliveryApi: MJChatDelivery, indexedDB: globalThis.indexedDB,
  fetchRequest: (...args) => fetch(...args), permissions: chrome.permissions, alarms: chrome.alarms, runtime: chrome.runtime });
if (chatIntegrations) {
  historyCommitObserver = chatIntegrations.persistHistory;
  chatIntegrations.ready().catch(() => {});
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || typeof message?.type !== 'string' || !message.type.startsWith('chat:')) return;
    chatIntegrations.handle(message, {
      sender,
      game: sender.tab && sender.frameId === 0 && sender.url?.startsWith('https://game.maj-soul.com/') &&
        (!sender.origin || sender.origin === 'https://game.maj-soul.com'),
      optionsPage: sender.url === chrome.runtime.getURL('options.html') && (sender.frameId === 0 || sender.frameId === undefined) &&
        (!sender.origin || sender.origin === `chrome-extension://${chrome.runtime.id}`),
    }).then(respond);
    return true;
  });
}

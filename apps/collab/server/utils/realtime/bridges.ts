import { getRealtime } from "./createRealtime";
import { documentTopicHub, presenceTopicHub } from "./localHub";
import { TopicBridge } from "./topic-bridge";

let documentBridge: TopicBridge | null = null;
let presenceBridge: TopicBridge | null = null;

export const getDocumentTopicBridge = (): TopicBridge => {
  if (documentBridge === null) {
    documentBridge = new TopicBridge(getRealtime().bus, documentTopicHub);
  }
  return documentBridge;
};

export const getPresenceTopicBridge = (): TopicBridge => {
  if (presenceBridge === null) {
    presenceBridge = new TopicBridge(getRealtime().bus, presenceTopicHub);
  }
  return presenceBridge;
};

export const resetTopicBridgesForTests = async (): Promise<void> => {
  await Promise.all([
    documentBridge?.close() ?? Promise.resolve(),
    presenceBridge?.close() ?? Promise.resolve(),
  ]);
  documentBridge = null;
  presenceBridge = null;
  documentTopicHub.clear();
  presenceTopicHub.clear();
};

import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";
import { $getRoot, $createTextNode, $createParagraphNode } from "lexical";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { ThemeProvider } from "@softmaple/editor/context/theme-provider";
import { EgWalkerAPI } from "@softmaple/eg-walker";
import {
  findInsertPosition,
  findDeletePosition,
  findDifferingRange,
} from "@/lib/text-diff";

export const Route = createFileRoute("/demo/rich-text-collab")({
  component: RichTextCollaborativeEditor,
});

function RichTextCollaborativeEditor() {
  const [editor1, setEditor1] = useState<LexicalEditor | undefined>(undefined);
  const [editor2, setEditor2] = useState<LexicalEditor | undefined>(undefined);
  const [api1] = useState(() => new EgWalkerAPI("rich-replica-1"));
  const [api2] = useState(() => new EgWalkerAPI("rich-replica-2"));
  const isUpdating1 = useRef(false);
  const isUpdating2 = useRef(false);
  const lastText1 = useRef("");
  const lastText2 = useRef("");

  // Sync from editor1 to editor2 via CRDT
  useEffect(() => {
    if (!editor1 || !editor2) return;

    const unregister = editor1.registerTextContentListener((text) => {
      if (isUpdating1.current || text === lastText1.current) return;

      const oldText = api1.getText();
      const newText = text;
      lastText1.current = text;

      try {
        if (newText.length > oldText.length) {
          // Insertion
          const insertPos = findInsertPosition(oldText, newText);
          const insertedText = newText.slice(
            insertPos,
            insertPos + (newText.length - oldText.length),
          );
          api1.insert(insertPos, insertedText);

          // Sync to replica2
          const events = api1.exportEventGraph();
          const latestEvent = events[events.length - 1];
          if (latestEvent) {
            api2.applyRemoteEvent(latestEvent).then(() => {
              const syncedText = api2.getText();
              if (syncedText !== lastText2.current) {
                isUpdating2.current = true;
                editor2.update(() => {
                  const root = $getRoot();
                  root.clear();
                  const paragraph = $createParagraphNode();
                  paragraph.append($createTextNode(syncedText));
                  root.append(paragraph);
                });
                lastText2.current = syncedText;
                setTimeout(() => {
                  isUpdating2.current = false;
                }, 100);
              }
            });
          }
        } else if (newText.length < oldText.length) {
          // Deletion
          const deletePos = findDeletePosition(oldText, newText);
          const deleteCount = oldText.length - newText.length;
          api1.delete(deletePos, deleteCount);

          // Sync to replica2
          const events = api1.exportEventGraph();
          const latestEvent = events[events.length - 1];
          if (latestEvent) {
            api2.applyRemoteEvent(latestEvent).then(() => {
              const syncedText = api2.getText();
              if (syncedText !== lastText2.current) {
                isUpdating2.current = true;
                editor2.update(() => {
                  const root = $getRoot();
                  root.clear();
                  const paragraph = $createParagraphNode();
                  paragraph.append($createTextNode(syncedText));
                  root.append(paragraph);
                });
                lastText2.current = syncedText;
                setTimeout(() => {
                  isUpdating2.current = false;
                }, 100);
              }
            });
          }
        } else if (newText.length === oldText.length && newText !== oldText) {
          // Replacement
          const { start, end } = findDifferingRange(oldText, newText);
          const deleteCount = end - start + 1;
          const replacementText = newText.slice(start, end + 1);

          api1.delete(start, deleteCount);
          api1.insert(start, replacementText);

          // Sync both events
          const events = api1.exportEventGraph();
          if (events.length >= 2) {
            const deleteEvent = events[events.length - 2];
            const insertEvent = events[events.length - 1];
            if (deleteEvent && insertEvent) {
              Promise.all([
                api2.applyRemoteEvent(deleteEvent),
                api2.applyRemoteEvent(insertEvent),
              ]).then(() => {
                const syncedText = api2.getText();
                if (syncedText !== lastText2.current) {
                  isUpdating2.current = true;
                  editor2.update(() => {
                    const root = $getRoot();
                    root.clear();
                    const paragraph = $createParagraphNode();
                    paragraph.append($createTextNode(syncedText));
                    root.append(paragraph);
                  });
                  lastText2.current = syncedText;
                  setTimeout(() => {
                    isUpdating2.current = false;
                  }, 100);
                }
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to sync from editor1:", error);
      }
    });

    return () => {
      unregister();
    };
  }, [editor1, editor2, api1, api2]);

  // Sync from editor2 to editor1 via CRDT
  useEffect(() => {
    if (!editor1 || !editor2) return;

    const unregister = editor2.registerTextContentListener((text) => {
      if (isUpdating2.current || text === lastText2.current) return;

      const oldText = api2.getText();
      const newText = text;
      lastText2.current = text;

      try {
        if (newText.length > oldText.length) {
          // Insertion
          const insertPos = findInsertPosition(oldText, newText);
          const insertedText = newText.slice(
            insertPos,
            insertPos + (newText.length - oldText.length),
          );
          api2.insert(insertPos, insertedText);

          // Sync to replica1
          const events = api2.exportEventGraph();
          const latestEvent = events[events.length - 1];
          if (latestEvent) {
            api1.applyRemoteEvent(latestEvent).then(() => {
              const syncedText = api1.getText();
              if (syncedText !== lastText1.current) {
                isUpdating1.current = true;
                editor1.update(() => {
                  const root = $getRoot();
                  root.clear();
                  const paragraph = $createParagraphNode();
                  paragraph.append($createTextNode(syncedText));
                  root.append(paragraph);
                });
                lastText1.current = syncedText;
                setTimeout(() => {
                  isUpdating1.current = false;
                }, 100);
              }
            });
          }
        } else if (newText.length < oldText.length) {
          // Deletion
          const deletePos = findDeletePosition(oldText, newText);
          const deleteCount = oldText.length - newText.length;
          api2.delete(deletePos, deleteCount);

          // Sync to replica1
          const events = api2.exportEventGraph();
          const latestEvent = events[events.length - 1];
          if (latestEvent) {
            api1.applyRemoteEvent(latestEvent).then(() => {
              const syncedText = api1.getText();
              if (syncedText !== lastText1.current) {
                isUpdating1.current = true;
                editor1.update(() => {
                  const root = $getRoot();
                  root.clear();
                  const paragraph = $createParagraphNode();
                  paragraph.append($createTextNode(syncedText));
                  root.append(paragraph);
                });
                lastText1.current = syncedText;
                setTimeout(() => {
                  isUpdating1.current = false;
                }, 100);
              }
            });
          }
        } else if (newText.length === oldText.length && newText !== oldText) {
          // Replacement
          const { start, end } = findDifferingRange(oldText, newText);
          const deleteCount = end - start + 1;
          const replacementText = newText.slice(start, end + 1);

          api2.delete(start, deleteCount);
          api2.insert(start, replacementText);

          // Sync both events
          const events = api2.exportEventGraph();
          if (events.length >= 2) {
            const deleteEvent = events[events.length - 2];
            const insertEvent = events[events.length - 1];
            if (deleteEvent && insertEvent) {
              Promise.all([
                api1.applyRemoteEvent(deleteEvent),
                api1.applyRemoteEvent(insertEvent),
              ]).then(() => {
                const syncedText = api1.getText();
                if (syncedText !== lastText1.current) {
                  isUpdating1.current = true;
                  editor1.update(() => {
                    const root = $getRoot();
                    root.clear();
                    const paragraph = $createParagraphNode();
                    paragraph.append($createTextNode(syncedText));
                    root.append(paragraph);
                  });
                  lastText1.current = syncedText;
                  setTimeout(() => {
                    isUpdating1.current = false;
                  }, 100);
                }
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to sync from editor2:", error);
      }
    });

    return () => {
      unregister();
    };
  }, [editor1, editor2, api1, api2]);

  return (
    <ThemeProvider defaultTheme="light" storageKey="rich-editor-theme">
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">
            Rich Text Collaborative Editor
          </h1>
          <p className="text-lg text-muted-foreground">
            Powered by <strong>Eg-Walker CRDT Algorithm</strong> with{" "}
            <strong>Lexical Editor</strong>. Type in either editor to see
            real-time synchronization with rich text formatting.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle id="rich-replica-1-label">
                Rich Editor - Replica 1
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                data-testid="rich-replica-1"
                aria-labelledby="rich-replica-1-label"
                className="min-h-[400px]"
              >
                <CoreEditor
                  activeEditor={editor1}
                  setActiveEditor={setEditor1}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle id="rich-replica-2-label">
                Rich Editor - Replica 2
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                data-testid="rich-replica-2"
                aria-labelledby="rich-replica-2-label"
                className="min-h-[400px]"
              >
                <CoreEditor
                  activeEditor={editor2}
                  setActiveEditor={setEditor2}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <p>
            ✨ Try formatting text with <strong>bold</strong>, <em>italic</em>,
            lists, and more using the toolbar!
          </p>
          <p>
            Both editors will stay synchronized while preserving plain text
            content through the CRDT algorithm.
          </p>
        </div>
      </div>
    </ThemeProvider>
  );
}

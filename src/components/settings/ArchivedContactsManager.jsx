import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Archive, RotateCcw, Loader2 } from "lucide-react";

// Settings → Voice setup → "Archived Contacts".
// Archiving a contact hides it from the Contacts list without deleting it. This
// is where those hidden contacts live — Restore puts one straight back.
export default function ArchivedContactsManager() {
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState(null);

  // Same query key the Contacts page uses, so restoring here updates that list too.
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => base44.entities.Contact.list(),
  });

  const archived = contacts
    .filter((c) => c.is_archived)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const restoreMutation = useMutation({
    mutationFn: (id) => base44.entities.Contact.update(id, { is_archived: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact restored");
    },
    onError: (err) => toast.error(err?.message || "Couldn't restore that contact"),
    onSettled: () => setRestoring(null),
  });

  const header = (
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
          <Archive className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <CardTitle className="text-lg">Archived Contacts</CardTitle>
          <CardDescription>Manage archived contacts</CardDescription>
        </div>
      </div>
    </CardHeader>
  );

  if (archived.length === 0) {
    return (
      <Card className="border-border/50">
        {header}
        <CardContent>
          <p className="text-sm text-muted-foreground">No archived contacts</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      {header}
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {archived.map((contact) => (
            <div key={contact.id} className="flex items-center justify-between gap-3 p-3 bg-muted/30 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{contact.name}</p>
                {contact.relationship_label && (
                  <p className="text-xs text-muted-foreground truncate">{contact.relationship_label}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="flex-shrink-0"
                onClick={() => {
                  setRestoring(contact.id);
                  restoreMutation.mutate(contact.id);
                }}
                disabled={restoring === contact.id}
              >
                {restoring === contact.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-2" />
                )}
                {restoring === contact.id ? "Restoring..." : "Restore"}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

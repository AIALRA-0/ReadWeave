export type ActionHandlers = {
    addLabel: {
        labelName: string;
        labelValue?: string;
    },
    addRelation: {
        relationName: string;
        targetNoteId: string;
    },
    deleteNote: {},
    deleteRevisions: {},
    deleteLabel: {
        labelName: string;
    },
    deleteRelation: {
        relationName: string;
    },
    renameNote: {
        newTitle: string;
    },
    renameLabel: {
        oldLabelName: string;
        newLabelName: string;
    },
    renameRelation: {
        oldRelationName: string;
        newRelationName: string;
    },
    updateLabelValue: {
        labelName: string;
        labelValue: string;
    },
    updateRelationTarget: {
        relationName: string;
        targetNoteId: string;
    },
    moveNote: {
        targetParentNoteId: string;
    },
    executeScript: {
        script: string;
    }
};

export type BulkActionData<T extends keyof ActionHandlers> = ActionHandlers[T] & { name: T };

export type BulkAction = {
  [K in keyof ActionHandlers]: { name: K; } & ActionHandlers[K];
}[keyof ActionHandlers];

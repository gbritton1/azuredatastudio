/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as sqlops from 'sqlops';

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import URI from 'vs/base/common/uri';
import { IBootstrapParams } from 'sql/services/bootstrap/bootstrapService';
import { RenderMimeRegistry } from 'sql/parts/notebook/outputs/registry';
import { ModelFactory } from 'sql/parts/notebook/models/modelFactory';
import { IConnectionProfile } from 'sql/parts/connection/common/interfaces';
import { NotebookInput } from 'sql/parts/notebook/notebookInput';

export const SERVICE_ID = 'notebookService';
export const INotebookService = createDecorator<INotebookService>(SERVICE_ID);

export const DEFAULT_NOTEBOOK_PROVIDER = 'builtin';
export const DEFAULT_NOTEBOOK_FILETYPE = 'IPYNB';

export interface INotebookService {
	_serviceBrand: any;

	onNotebookEditorAdd: Event<INotebookEditor>;
	onNotebookEditorRemove: Event<INotebookEditor>;

	/**
	 * Register a metadata provider
	 */
	registerProvider(providerId: string, provider: INotebookProvider): void;

	/**
	 * Register a metadata provider
	 */
	unregisterProvider(providerId: string): void;

	/**
	 * Initializes and returns a Notebook manager that can handle all important calls to open, display, and
	 * run cells in a notebook.
	 * @param providerId ID for the provider to be used to instantiate a backend notebook service
	 * @param uri URI for a notebook that is to be opened. Based on this an existing manager may be used, or
	 * a new one may need to be created
	 */
	getOrCreateNotebookManager(providerId: string, uri: URI): Thenable<INotebookManager>;

	addNotebookEditor(editor: INotebookEditor): void;

	removeNotebookEditor(editor: INotebookEditor): void;

	listNotebookEditors(): INotebookEditor[];

	shutdown(): void;

	getMimeRegistry(): RenderMimeRegistry;
}

export interface INotebookProvider {
	readonly providerId: string;
	getNotebookManager(notebookUri: URI): Thenable<INotebookManager>;
	handleNotebookClosed(notebookUri: URI): void;
}

export interface INotebookManager {
	providerId: string;
	readonly contentManager: sqlops.nb.ContentManager;
	readonly sessionManager: sqlops.nb.SessionManager;
	readonly serverManager: sqlops.nb.ServerManager;
}

export interface INotebookParams extends IBootstrapParams {
	notebookUri: URI;
	input: NotebookInput;
	providerId: string;
	isTrusted: boolean;
	profile?: IConnectionProfile;
	modelFactory?: ModelFactory;
}

export interface INotebookEditor {
	readonly notebookParams: INotebookParams;
	readonly id: string;
	isDirty(): boolean;
	isActive(): boolean;
	isVisible(): boolean;
	save(): Promise<boolean>;
}
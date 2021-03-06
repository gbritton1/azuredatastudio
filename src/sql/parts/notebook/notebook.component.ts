/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the Source EULA. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import './notebookStyles';

import { nb } from 'sqlops';

import { OnInit, Component, Inject, forwardRef, ElementRef, ChangeDetectorRef, ViewChild, OnDestroy } from '@angular/core';

import { IColorTheme, IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import * as themeColors from 'vs/workbench/common/theme';
import { INotificationService, INotification } from 'vs/platform/notification/common/notification';
import { localize } from 'vs/nls';

import { CommonServiceInterface } from 'sql/services/common/commonServiceInterface.service';
import { AngularDisposable } from 'sql/base/common/lifecycle';

import { CellTypes, CellType } from 'sql/parts/notebook/models/contracts';
import { ICellModel, IModelFactory, notebookConstants } from 'sql/parts/notebook/models/modelInterfaces';
import { IConnectionManagementService, IConnectionDialogService } from 'sql/parts/connection/common/connectionManagement';
import { INotebookService, INotebookParams, INotebookManager, INotebookEditor } from 'sql/services/notebook/notebookService';
import { IBootstrapParams } from 'sql/services/bootstrap/bootstrapService';
import { NotebookModel, NotebookContentChange } from 'sql/parts/notebook/models/notebookModel';
import { ModelFactory } from 'sql/parts/notebook/models/modelFactory';
import * as notebookUtils from './notebookUtils';
import { Deferred } from 'sql/base/common/promise';
import { IConnectionProfile } from 'sql/parts/connection/common/interfaces';
import { Taskbar } from 'sql/base/browser/ui/taskbar/taskbar';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { KernelsDropdown, AttachToDropdown, AddCellAction, TrustedAction, SaveNotebookAction } from 'sql/parts/notebook/notebookActions';
import { attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { MenuId, IMenuService, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IAction, Action, IActionItem } from 'vs/base/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { fillInActions, LabeledMenuItemActionItem } from 'vs/platform/actions/browser/menuItemActionItem';
import { IObjectExplorerService } from 'sql/parts/objectExplorer/common/objectExplorerService';
import * as TaskUtilities from 'sql/workbench/common/taskUtilities';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export const NOTEBOOK_SELECTOR: string = 'notebook-component';


@Component({
	selector: NOTEBOOK_SELECTOR,
	templateUrl: decodeURI(require.toUrl('./notebook.component.html'))
})
export class NotebookComponent extends AngularDisposable implements OnInit, OnDestroy, INotebookEditor {
	@ViewChild('toolbar', { read: ElementRef }) private toolbar: ElementRef;
	private _model: NotebookModel;
	private _isInErrorState: boolean = false;
	private _errorMessage: string;
	protected _actionBar: Taskbar;
	private _activeCell: ICellModel;
	protected isLoading: boolean;
	private notebookManager: INotebookManager;
	private _modelReadyDeferred = new Deferred<NotebookModel>();
	private _modelRegisteredDeferred = new Deferred<NotebookModel>();
	private profile: IConnectionProfile;
	private _trustedAction: TrustedAction;
	private _activeCellId: string;


	constructor(
		@Inject(forwardRef(() => CommonServiceInterface)) private _bootstrapService: CommonServiceInterface,
		@Inject(forwardRef(() => ChangeDetectorRef)) private _changeRef: ChangeDetectorRef,
		@Inject(IWorkbenchThemeService) private themeService: IWorkbenchThemeService,
		@Inject(IConnectionManagementService) private connectionManagementService: IConnectionManagementService,
		@Inject(IObjectExplorerService) private objectExplorerService: IObjectExplorerService,
		@Inject(IEditorService) private editorService: IEditorService,
		@Inject(INotificationService) private notificationService: INotificationService,
		@Inject(INotebookService) private notebookService: INotebookService,
		@Inject(IBootstrapParams) private _notebookParams: INotebookParams,
		@Inject(IInstantiationService) private instantiationService: IInstantiationService,
		@Inject(IContextMenuService) private contextMenuService: IContextMenuService,
		@Inject(IContextViewService) private contextViewService: IContextViewService,
		@Inject(IConnectionDialogService) private connectionDialogService: IConnectionDialogService,
		@Inject(IContextKeyService) private contextKeyService: IContextKeyService,
		@Inject(IMenuService) private menuService: IMenuService,
		@Inject(IKeybindingService) private keybindingService: IKeybindingService
	) {
		super();
		this.updateProfile();
		this.isLoading = true;
	}

	private updateProfile(): void {
		this.profile = this.notebookParams!.profile;
		if (!this.profile) {
			// use global connection if possible
			let profile = TaskUtilities.getCurrentGlobalConnection(this.objectExplorerService, this.connectionManagementService, this.editorService);
			// TODO use generic method to match kernel with valid connection that's compatible. For now, we only have 1
			if (profile && profile.providerName === notebookConstants.hadoopKnoxProviderName) {
				this.profile = profile;
			} else {
				// if not, try 1st active connection that matches our filter
				let profiles = this.connectionManagementService.getActiveConnections([notebookConstants.hadoopKnoxProviderName]);
				if (profiles && profiles.length > 0) {
					this.profile = profiles[0];
				}
			}
		}
	}

	ngOnInit() {
		this._register(this.themeService.onDidColorThemeChange(this.updateTheme, this));
		this.updateTheme(this.themeService.getColorTheme());
		this.notebookService.addNotebookEditor(this);
		this.initActionBar();
		this.doLoad();
	}

	ngOnDestroy() {
		if (this.notebookService) {
			this.notebookService.removeNotebookEditor(this);
		}
	}

	public get model(): NotebookModel {
		return this._model;
	}

	public get activeCellId(): string {
		return this._activeCellId;
	}

	public get modelRegistered(): Promise<NotebookModel> {
		return this._modelRegisteredDeferred.promise;
	}

	protected get cells(): ReadonlyArray<ICellModel> {
		return this._model ? this._model.cells : [];
	}

	private updateTheme(theme: IColorTheme): void {
		let toolbarEl = <HTMLElement>this.toolbar.nativeElement;
		toolbarEl.style.borderBottomColor = theme.getColor(themeColors.SIDE_BAR_BACKGROUND, true).toString();
	}

	public selectCell(cell: ICellModel) {
		if (cell !== this._activeCell) {
			if (this._activeCell) {
				this._activeCell.active = false;
			}
			this._activeCell = cell;
			this._activeCell.active = true;
			this._model.activeCell = this._activeCell;
			this._activeCellId = cell.id;
			this._changeRef.detectChanges();
		}
	}

	// Add cell based on cell type
	public addCell(cellType: CellType)
	{
		this._model.addCell(cellType);
	}

	// Updates Notebook model's trust details
	public updateModelTrustDetails(isTrusted: boolean)
	{
		this._model.trustedMode = isTrusted;
		this._model.cells.forEach(cell => {
			cell.trustedMode = isTrusted;
		});
		this.setDirty(true);
		this._changeRef.detectChanges();
	}

	public onKeyDown(event) {
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowRight':
				let nextIndex = (this.findCellIndex(this._activeCell) + 1) % this.cells.length;
				this.selectCell(this.cells[nextIndex]);
				break;
			case 'ArrowUp':
			case 'ArrowLeft':
				let index = this.findCellIndex(this._activeCell);
				if (index === 0) {
					index = this.cells.length;
				}
				this.selectCell(this.cells[--index]);
				break;
			default:
				break;
		}
	}

	private async doLoad(): Promise<void> {
		try {
			await this.loadModel();
			this.setLoading(false);
			this._modelReadyDeferred.resolve(this._model);
		} catch (error) {
			this.setViewInErrorState(localize('displayFailed', 'Could not display contents: {0}', error));
			this.setLoading(false);
			this._modelReadyDeferred.reject(error);
		}
	}

	private setLoading(isLoading: boolean): void {
		this.isLoading = isLoading;
		this._changeRef.detectChanges();
	}

	private async loadModel(): Promise<void> {
		this.notebookManager = await this.notebookService.getOrCreateNotebookManager(this._notebookParams.providerId, this._notebookParams.notebookUri);
		let model = new NotebookModel({
			factory: this.modelFactory,
			notebookUri: this._notebookParams.notebookUri,
			connectionService: this.connectionManagementService,
			notificationService: this.notificationService,
			notebookManager: this.notebookManager
		}, false, this.profile);
		model.onError((errInfo: INotification) => this.handleModelError(errInfo));
		await model.requestModelLoad(this._notebookParams.isTrusted);
		model.contentChanged((change) => this.handleContentChanged(change));
		this._model = model;
		this.updateToolbarComponents(this._model.trustedMode);
		this._register(model);
		this._modelRegisteredDeferred.resolve(this._model);
		model.backgroundStartSession();
		this._changeRef.detectChanges();
	}

	// Updates toolbar components
	private updateToolbarComponents(isTrusted: boolean)
	{
		if(this._trustedAction)
		{
			this._trustedAction.enabled = true;
			this._trustedAction.trusted = isTrusted;
		}
	}

	private get modelFactory(): IModelFactory {
		if (!this._notebookParams.modelFactory) {
			this._notebookParams.modelFactory = new ModelFactory();
		}
		return this._notebookParams.modelFactory;
	}
	private handleModelError(notification: INotification): void {
		this.notificationService.notify(notification);
	}

	private handleContentChanged(change: NotebookContentChange) {
		// Note: for now we just need to set dirty state and refresh the UI.
		this.setDirty(true);
		this._changeRef.detectChanges();
	}

	findCellIndex(cellModel: ICellModel): number {
		return this._model.cells.findIndex((cell) => cell.id === cellModel.id);
	}

	private setViewInErrorState(error: any): any {
		this._isInErrorState = true;
		this._errorMessage = notebookUtils.getErrorMessage(error);
		// For now, send message as error notification #870 covers having dedicated area for this
		this.notificationService.error(error);
	}

	protected initActionBar() {
		let kernelContainer = document.createElement('div');
		let kernelDropdown = new KernelsDropdown(kernelContainer, this.contextViewService, this.modelRegistered);
		kernelDropdown.render(kernelContainer);
		attachSelectBoxStyler(kernelDropdown, this.themeService);

		let attachToContainer = document.createElement('div');
		let attachTodropdwon = new AttachToDropdown(attachToContainer, this.contextViewService, this.modelRegistered,
			this.connectionManagementService, this.connectionDialogService, this.notificationService);
		attachTodropdwon.render(attachToContainer);
		attachSelectBoxStyler(attachTodropdwon, this.themeService);


		let addCodeCellButton = new AddCellAction('notebook.AddCodeCell', localize('code', 'Code'), 'notebook-button icon-add');
		addCodeCellButton.cellType = CellTypes.Code;

		let addTextCellButton = new AddCellAction('notebook.AddTextCell',localize('text', 'Text'), 'notebook-button icon-add');
		addTextCellButton.cellType = CellTypes.Markdown;

		this._trustedAction = this.instantiationService.createInstance(TrustedAction, 'notebook.Trusted');
		this._trustedAction.enabled = false;

		let saveNotebookButton = this.instantiationService.createInstance(SaveNotebookAction, 'notebook.SaveNotebook', localize('save', 'Save'), 'notebook-button icon-save');

		// Get all of the menu contributions that use the ID 'notebook/toolbar'.
		// Then, find all groups (currently we don't leverage the contributed
		// groups functionality for the notebook toolbar), and fill in the 'primary'
		// array with items that don't list a group. Finally, add any actions from
		// the primary array to the end of the toolbar.
		const notebookBarMenu = this.menuService.createMenu(MenuId.NotebookToolbar, this.contextKeyService);
		let groups = notebookBarMenu.getActions({ arg: null, shouldForwardArgs: true });
		let primary: IAction[] = [];
		let secondary: IAction[] = [];
		fillInActions(groups, {primary, secondary}, false, (group: string) => group === undefined);

		let taskbar = <HTMLElement>this.toolbar.nativeElement;
		this._actionBar = new Taskbar(taskbar, this.contextMenuService, { actionItemProvider: action => this.actionItemProvider(action as Action)});
		this._actionBar.context = this;
		this._actionBar.setContent([
			{ element: kernelContainer },
			{ element: attachToContainer },
			{ action: addCodeCellButton },
			{ action: addTextCellButton },
			{ action: saveNotebookButton },
			{ action: this._trustedAction }
		]);

		// Primary actions are categorized as those that are added to the 'horizontal' group.
		// For the vertical toolbar, we can do the same thing and instead use the 'vertical' group.
		for (let action of primary) {
			this._actionBar.addAction(action);
		}
	}

	public async save(): Promise<boolean> {
		try {
			let saved = await this._model.saveModel();
			if (saved) {
				this.setDirty(false);
			}
			return saved;
		} catch (err) {
			this.notificationService.error(localize('saveFailed', 'Failed to save notebook: {0}', notebookUtils.getErrorMessage(err)));
			return false;
		}
	}

	private setDirty(isDirty: boolean): void {
		if(this._notebookParams.input){
			this._notebookParams.input.setDirty(isDirty);
		}
	}

	private actionItemProvider(action: Action): IActionItem {
		// Check extensions to create ActionItem; otherwise, return undefined
		// This is similar behavior that exists in MenuItemActionItem
		if (action instanceof MenuItemAction) {
			return new LabeledMenuItemActionItem(action, this.keybindingService, this.notificationService, this.contextMenuService, 'notebook-button');
		}
		return undefined;
	}

	public get notebookParams(): INotebookParams {
		return this._notebookParams;
	}

	public get id(): string {
		return this._notebookParams.notebookUri.toString();
	}

	isActive(): boolean {
		return this.editorService.activeEditor === this.notebookParams.input;
	}

	isVisible(): boolean {
		let notebookEditor = this.notebookParams.input;
		return this.editorService.visibleEditors.some(e => e === notebookEditor);
	}

	isDirty(): boolean {
		return this.notebookParams.input.isDirty();
	}
}

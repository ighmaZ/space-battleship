import 'phaser'
import { Socket } from 'socket.io-client'

import { ErrorTypes, SCENES } from 'utils/constants'
import debounce from 'lodash/debounce'

import RoomSocketHandler from './socket'
import RoomUI from './ui'
import i18next from 'i18n'

class Room extends Phaser.Scene {
  private UI?: RoomUI
  private socketHandler?: RoomSocketHandler
  private returnKey?: Phaser.Input.Keyboard.Key
  private reason?: string
  private countryCode?: string

  constructor() {
    super(SCENES.Room)
  }

  init(data: { webSocketClient: Socket; reason?: string; countryCode?: string }): void {
    this.socketHandler = new RoomSocketHandler(data.webSocketClient)
    this.returnKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER)
    this.reason = data.reason
    this.countryCode = data.countryCode ?? localStorage.getItem('countryCode') ?? ''
  }

  setupWebsocketListeners = (): void => {
    const handleGetUsersList = (value: string): void => {
      const users = JSON.parse(value).reduce(
        (
          acc: Record<string, string>,
          {
            id,
            name,
            isPlaying,
            countryCode,
          }: { id: string; name: string; isPlaying: boolean; countryCode: string }
        ) => ({
          ...acc,
          [id]: { name, isPlaying, countryCode },
        }),
        {}
      )
      this.UI?.updateUsers(users)
    }

    const handleUserDisconnected = (value: string): void => {
      this.UI?.addQuittedMessage(value)
      this.UI?.removeUser(value)
    }

    const handleCloseChallenge = (value: string): void => {
      const { challengeId, reason } = JSON.parse(value)
      if (reason === 'TIMEOUT') {
        this.UI?.setChallengeClosedMessage(challengeId, i18next.t('The challenge timed out'))
        return
      }
      const name = this.socketHandler?.isMe(reason) ? i18next.t('You') : i18next.t('The opponent')
      this.UI?.setChallengeClosedMessage(
        challengeId,
        `${name ?? i18next.t('The opponent')} ${i18next.t('canceled the challenge')}`
      )
    }

    const handleErrorChallenge = (value: string): void => {
      const { message } = JSON.parse(value)
      this.UI?.addErrorMessage(message)
    }

    const handleAcceptChallenge = (message: string): void => {
      const { challenger, challenged } = JSON.parse(message)
      const challengerName = this.UI?.getUserName(challenger)
      const challengedName = this.UI?.getUserName(challenged)
      this.scene.start(SCENES.ShipsSelect, {
        webSocketClient: this.socketHandler?.getWebSocketClient(),
        challenged,
        challenger,
        challengerName,
        challengedName,
      })
    }

    const handleChallenge = (value: string): void => {
      const { challengeId, challengerId, challengedId } = JSON.parse(value)
      if (this.socketHandler?.isMe(challengedId)) {
        this.UI?.addChallengedMessage(challengerId, challengeId)
        return
      }
      if (this.socketHandler?.isMe(challengerId)) {
        this.UI?.addChallengerMessage(challengedId, challengeId)
      }
    }

    const handleUserConnected = (value: string): void => {
      const item = JSON.parse(value)
      this.UI?.updateUsers({
        ...this.UI.getUsers(),
        [item.id]: {
          name: item.name,
          isPlaying: item.isPlaying,
          countryCode: item.countryCode,
        },
      })
      this.UI?.addJoinedMessage(item.name)
    }

    const handleRoomMessage = (value: string): void => {
      const { id, message } = JSON.parse(value)
      this.UI?.addUserMessage(id, message)
    }

    const handleDisconnect = () => {
      this.scene.start(SCENES.Identification, { error: ErrorTypes.disconnected })
    }

    const handleUserIsPlaying = (socketId: string) => {
      this.UI?.updateUserIsPlaying(socketId, true)
      this.UI?.addJoinedAGameMessage(socketId)
    }

    const handleUserIsBackFromGame = (socketId: string) => {
      this.UI?.updateUserIsPlaying(socketId, false)
      this.UI?.addBackFromGameMessage(socketId)
    }

    const handleUpdateCountryCode = (value: string) => {
      const { id, countryCode } = JSON.parse(value)
      this.UI?.updateUserCountryCode(id, countryCode)
    }

    this.socketHandler?.createRoomSocketHandler({
      handleGetUsersList,
      handleUserDisconnected,
      handleUserConnected,
      handleRoomMessage,
      handleChallenge,
      handleAcceptChallenge,
      handleCloseChallenge,
      handleUpdateCountryCode,
      handleErrorChallenge,
      handleDisconnect,
      handleUserIsBackFromGame,
      handleUserIsPlaying,
    })
  }

  setupButtonListeners = (): void => {
    const handleSubmitMessage = (message?: string): void => {
      this.socketHandler?.sendMessage(message ?? '')
    }

    const handleSubmitChallenge = (selectedValue?: string): void => {
      if (!selectedValue) {
        this.UI?.addErrorMessage(i18next.t('You need to select someone to challenge'))
        return
      }
      if (this.socketHandler?.isMe(selectedValue)) {
        this.UI?.addErrorMessage(i18next.t("You can't challenge yourself, select someone else"))
        return
      }
      this.socketHandler?.sendChallenge(selectedValue)
    }

    this.UI = new RoomUI(this, {
      handleSubmitChallenge,
      handleSubmitMessage,
      handleGoBack: () => {
        this.socketHandler?.close()
        this.scene.start(SCENES.Identification)
      },
      handleUpdateFlag: (countryCode: string) => {
        this.socketHandler?.sendUpdateFlag(countryCode)
        localStorage.setItem('countryCode', countryCode)
        this.UI?.updateProps({ countryCode })
      },
      handleRefuseChallengeClick: (id: string) => this.socketHandler?.sendMessageRefuse(id),
      handleAcceptChallengeClick: (id: string) => this.socketHandler?.sendMessageAccept(id),
      handleCloseChallengeClick: (id: string) => this.socketHandler?.sendMessageCancel(id),
      handleCloseMessage: () => {
        this.UI?.updateProps({ reason: undefined })
      },
      reason: this.reason,
      countryCode: this.countryCode ?? '',
    })

    this.returnKey?.on(
      'down',
      debounce(
        () => {
          this.UI?.sendMessage()
        },
        300,
        { leading: true, trailing: false }
      )
    )
  }

  create(): void {
    this.setupButtonListeners()
    this.setupWebsocketListeners()
    this.socketHandler?.sendGetUsersList()
  }
}

export default Room

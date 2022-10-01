import { Group, Ride } from '../typings/ride'
import Bot from 'node-telegram-bot-api'
import { Database } from './database.js'
import { weekdays, emojis } from '../utils/const.js'
import * as format from '../utils/format.js'
import { getUserLink } from '../utils/messages.js'

export default class RideManager {
  db: Database

  constructor() {
    this.db = new Database()
    this.db.connect()
  }

  public async addRide(
    chatId: number,
    rideInfo: { user: Bot.User; time: Date; description: String; direction: string }
  ): Promise<boolean> {
    const ride = {
      full: 0,
      ...rideInfo
    }

    return await this.db.updateGroup(
      chatId,
      {
        $set: {
          [rideInfo.direction + '.' + rideInfo.user.id]: ride
        }
      },
      { upsert: true }
    )
  }

  public async removeRide(
    chatId: number,
    rideInfo: { userId: number; direction: string }
  ): Promise<boolean> {
    return await this.db.updateGroup(
      chatId,
      {
        $unset: {
          [rideInfo.direction + '.' + rideInfo.userId]: ''
        }
      },
      { upsert: false }
    )
  }

  public async setRideFull(
    chatId: number,
    rideInfo: { userId: number; direction: string; state: number }
  ): Promise<boolean> {
    return await this.db.updateGroup(
      chatId,
      {
        $set: {
          [rideInfo.direction + '.' + rideInfo.userId + '.full']: rideInfo.state
        }
      },
      { upsert: false }
    )
  }

  public async cleanRides(chatId: number, now: Date) {
    const docs = await this.db.scrapeGroupRides(chatId)
    if (docs.length === 0) return

    // If it exists, it gets only the first document, because
    // the chat id is unique
    const rides = { ...docs[0]['going'], ...docs[0]['coming'] }
    const ridesToRemove = Object.values(rides).filter((ride: Ride) => ride.time < now)

    let ridesToApply: { [x: string]: string } = {}
    for (const ride of ridesToRemove) {
      const key: string = `${ride.direction}.${ride.user.id}`
      ridesToApply[key] = ''
    }

    this.db.updateGroup(
      chatId,
      {
        $unset: ridesToApply
      },
      { upsert: false }
    )
  }

  public async listRidesAsString(chatId: number): Promise<string> {
    let result = await this.db.scrapeGroupRides(chatId)

    if (result.length === 0) return ''

    let group = result[0] as Group
    const comingRides = group.coming !== undefined ? Object.values(group.coming) : []
    const goingRides = group.going !== undefined ? Object.values(group.going) : []
    let totalRides = comingRides.concat(goingRides)

    //It sorts by day/month, then direction, then time
    totalRides.sort(
      (a, b) =>
        ((new Date(a.time).setHours(0, 0, 0) <
          new Date(b.time).setHours(0, 0, 0)) as unknown as number) ||
        b.direction.localeCompare(a.direction) ||
        ((new Date(a.time) < new Date(b.time)) as unknown as number)
    )

    // Auxiliary variables
    let message = ''
    let date, hours, minutes, day, month, weekday
    let previousDirection: string, previousDate: string
    let rideInfo
    let changedDate = false

    // Assemble the message while iterating over the
    // rides array
    totalRides.forEach((ride) => {
      date = new Date(ride.time)
      hours = date.getHours()
      minutes = date.getMinutes()
      day = date.getDate()
      month = date.getMonth() + 1
      weekday = weekdays.pt_br[date.getDay()]

      // Check if day/month changed to print a new line
      if (!previousDate || previousDate !== date.toDateString()) {
        changedDate = true
        if (previousDate) message += '\n'
        message +=
          format.getSpecialDayEmoji(day, month) +
          '<b>' +
          format.addZeroPadding(day) +
          '/' +
          format.addZeroPadding(month) +
          ' - ' +
          weekday +
          '</b> ' +
          emojis[date.getDay()] +
          '\n'
      }

      // Check if direction changed to print a new line and the new direction
      if (!previousDirection || changedDate || previousDirection !== ride.direction) {
        message += '\n'
        message += ride.direction === 'going' ? '<b>IDA</b>\n' : '<b>VOLTA</b>\n'
      }

      // Ride info (time and description)
      rideInfo =
        ' - ' +
        format.addZeroPadding(hours) +
        ':' +
        format.addZeroPadding(minutes) +
        ' - ' +
        ride.description

      // If it is full, generate strikethrough text.
      if (ride.full === 1) {
        rideInfo = ride.user.first_name + ' ' + (ride.user.last_name || '') + rideInfo
        message += format.strikeThrough(rideInfo) + '\n'
      }
      // If it is not, create a link for the user.
      else {
        rideInfo =
          format.getUserEmoji(ride.user) +
          ' ' +
          getUserLink(ride.user.id, ride.user.first_name, ride.user.last_name) +
          rideInfo
        message += rideInfo + '\n'
      }

      previousDirection = ride.direction
      previousDate = date.toDateString()
      changedDate = false
    })

    return message
  }
}
